#!/usr/bin/env node
/**
 * Job Automation Agent - Standalone Runner
 * Scrapes jobs, evaluates fit with AI (Groq - free), and sends a daily report email.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const PROFILE_PATH = path.join(__dirname, '../config/candidate_profile.json');
const REPORT_DIR = path.join(__dirname, '../reports');
const LOG_DIR = path.join(__dirname, '../logs');
const DRY_RUN = process.env.DRY_RUN === 'true';
const profile = JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf8'));

[REPORT_DIR, LOG_DIR].forEach(dir => fs.mkdirSync(dir, { recursive: true }));

function log(level, message, data = {}) {
  const entry = { timestamp: new Date().toISOString(), level, message, ...data };
  console.log(JSON.stringify(entry));
  fs.appendFileSync(
    path.join(LOG_DIR, `run_${new Date().toISOString().split('T')[0]}.log`),
    JSON.stringify(entry) + '\n'
  );
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'JobBot/1.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Failed to parse JSON from ${url}: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
  });
}

async function scrapeRemotive() {
  try {
    const query = encodeURIComponent(profile.desired_roles[0] || 'software engineer');
    const data = await fetchJSON(`https://remotive.com/api/remote-jobs?search=${query}&limit=50`);
    const jobs = (data.jobs || []).map(job => ({
      source: 'Remotive', title: job.title || '',
      company: job.company_name || 'Unknown',
      location: job.candidate_required_location || 'Remote',
      url: job.url || '',
      description: (job.description || '').replace(/<[^>]*>/g, '').slice(0, 600)
    }));
    log('info', `Remotive: scraped ${jobs.length} jobs`);
    return jobs;
  } catch (e) { log('error', `Remotive failed: ${e.message}`); return []; }
}

async function scrapeTheMuse() {
  try {
    const query = encodeURIComponent(profile.desired_roles[0] || 'software engineer');
    const data = await fetchJSON(`https://www.themuse.com/api/public/jobs?category=${query}&page=1`);
    const jobs = (data.results || []).map(job => ({
      source: 'TheMuse', title: job.name || '',
      company: job.company?.name || 'Unknown',
      location: (job.locations || []).map(l => l.name).join(', ') || 'Remote',
      url: job.refs?.landing_page || '',
      description: (job.contents || '').replace(/<[^>]*>/g, '').slice(0, 600)
    }));
    log('info', `TheMuse: scraped ${jobs.length} jobs`);
    return jobs;
  } catch (e) { log('error', `TheMuse failed: ${e.message}`); return []; }
}

async function scrapeAdzuna() {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) { log('warn', 'Adzuna credentials not set - skipping'); return []; }
  try {
    const query = encodeURIComponent(profile.desired_roles[0] || 'software engineer');
    const data = await fetchJSON(`https://api.adzuna.com/v1/api/jobs/gb/search/1?app_id=${appId}&app_key=${appKey}&results_per_page=20&what=${query}`);
    const jobs = (data.results || []).map(job => ({
      source: 'Adzuna', title: job.title || '',
      company: job.company?.display_name || 'Unknown',
      location: job.location?.display_name || 'Unknown',
      url: job.redirect_url || '',
      description: (job.description || '').slice(0, 600)
    }));
    log('info', `Adzuna: scraped ${jobs.length} jobs`);
    return jobs;
  } catch (e) { log('error', `Adzuna failed: ${e.message}`); return []; }
}

function filterJobs(jobs) {
  const keywords = profile.desired_roles.map(r => r.toLowerCase());
  const exclude = (profile.job_filters?.exclude_keywords || []).map(k => k.toLowerCase());
  const requireRemote = profile.job_filters?.require_remote === true;
  return jobs.filter(job => {
    const title = job.title.toLowerCase();
    const desc = job.description.toLowerCase();
    const loc = job.location.toLowerCase();
    return keywords.some(kw => title.includes(kw) || desc.includes(kw)) &&
      !exclude.some(kw => title.includes(kw)) &&
      (!requireRemote || loc.includes('remote') || loc.includes('anywhere'));
  });
}

function generateCoverLetter(job) {
  const skillsList = Object.values(profile.skills || {}).flat().slice(0, 3).join(', ');
  return profile.cover_letter_template
    .replace('{role}', job.title).replace('{company}', job.company)
    .replace('{years}', profile.experience_years)
    .replace('{skills}', skillsList);
}

async function evaluateJobWithAI(job) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    log('warn', 'GROQ_API_KEY not set - using default score');
    return { score: 70, cover_letter: generateCoverLetter(job) };
  }
  const skillsList = Object.values(profile.skills || {}).flat().slice(0, 5).join(', ');
  const payload = JSON.stringify({
    model: 'llama3-8b-8192',
    messages: [{
      role: 'user',
      content: `Evaluate this job for a candidate with ${profile.experience_years} year(s) experience skilled in ${skillsList}.
Title: ${job.title}
Company: ${job.company}
Desc: ${job.description.slice(0, 300)}
Respond ONLY as JSON: {"score":<0-100>}`
    }],
    max_tokens: 60,
    temperature: 0.2
  });
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          const content = JSON.parse(result.choices?.[0]?.message?.content || '{}');
          resolve({ score: content.score || 70, cover_letter: generateCoverLetter(job) });
        } catch { resolve({ score: 70, cover_letter: generateCoverLetter(job) }); }
      });
    });
    req.on('error', () => resolve({ score: 70, cover_letter: generateCoverLetter(job) }));
    req.write(payload); req.end();
  });
}

async function sendEmailReport(applications, totalScraped) {
  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
  });
  const today = new Date().toISOString().split('T')[0];
  const rows = applications.map(app => `<tr><td style="padding:8px;">${app.title}</td><td style="padding:8px;">${app.company}</td><td style="padding:8px;">${app.location}</td><td style="padding:8px;text-align:center;"><b>${app.score}/100</b></td><td style="padding:8px;"><a href="${app.url}">View</a></td></tr>`).join('');
  const html = `<html><body style="font-family:Arial,sans-serif;max-width:750px;margin:auto;"><div style="background:linear-gradient(135deg,#4a90e2,#7b68ee);padding:25px;border-radius:12px;color:white;text-align:center;"><h1>Daily Job Report</h1><p>${today}</p></div><p><b>Jobs Scraped:</b> ${totalScraped} | <b>Applications:</b> ${applications.length}</p><table style="width:100%;border-collapse:collapse;"><thead><tr style="background:#4a90e2;color:white;"><th style="padding:10px;">Title</th><th style="padding:10px;">Company</th><th style="padding:10px;">Location</th><th style="padding:10px;">Score</th><th style="padding:10px;">Link</th></tr></thead><tbody>${rows}</tbody></table><p style="color:#aaa;font-size:12px;text-align:center;margin-top:20px;">Powered by N8N Job Automation Agent (Groq AI)</p></body></html>`;
  await transporter.sendMail({ from: \