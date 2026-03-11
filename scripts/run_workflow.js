#!/usr/bin/env node
/**
 * Job Automation Agent - Standalone Runner
 * Scrapes jobs, evaluates fit with AI (Groq - free), and sends a daily report email.
 * Sources: Remotive, TheMuse, Adzuna, Jobicy, Greenhouse, Lever
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

function log(level, message, data) {
  if (!data) data = {};
  const entry = Object.assign({ timestamp: new Date().toISOString(), level: level, message: message }, data);
  console.log(JSON.stringify(entry));
  fs.appendFileSync(
    path.join(LOG_DIR, 'run_' + new Date().toISOString().split('T')[0] + '.log'),
    JSON.stringify(entry) + '\n'
  );
}

function fetchJSON(url) {
  return new Promise(function(resolve, reject) {
    var req = https.get(url, { headers: { 'User-Agent': 'JobBot/1.0' } }, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Failed to parse JSON from ' + url + ': ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, function() { req.destroy(); reject(new Error('Timeout: ' + url)); });
  });
}

async function scrapeRemotive() {
  try {
    var query = encodeURIComponent(profile.desired_roles[0] || 'marketing');
    var data = await fetchJSON('https://remotive.com/api/remote-jobs?search=' + query + '&limit=50');
    var jobs = (data.jobs || []).map(function(job) {
      return {
        source: 'Remotive', title: job.title || '',
        company: job.company_name || 'Unknown',
        location: job.candidate_required_location || 'Remote',
        url: job.url || '',
        description: (job.description || '').replace(/<[^>]*>/g, '').slice(0, 600)
      };
    });
    log('info', 'Remotive: scraped ' + jobs.length + ' jobs');
    return jobs;
  } catch (e) { log('error', 'Remotive failed: ' + e.message); return []; }
}

async function scrapeTheMuse() {
  try {
    var query = encodeURIComponent(profile.desired_roles[0] || 'marketing');
    var data = await fetchJSON('https://www.themuse.com/api/public/jobs?category=' + query + '&page=1');
    var jobs = (data.results || []).map(function(job) {
      return {
        source: 'TheMuse', title: job.name || '',
        company: (job.company && job.company.name) || 'Unknown',
        location: (job.locations || []).map(function(l) { return l.name; }).join(', ') || 'Remote',
        url: (job.refs && job.refs.landing_page) || '',
        description: (job.contents || '').replace(/<[^>]*>/g, '').slice(0, 600)
      };
    });
    log('info', 'TheMuse: scraped ' + jobs.length + ' jobs');
    return jobs;
  } catch (e) { log('error', 'TheMuse failed: ' + e.message); return []; }
}

async function scrapeAdzuna() {
  var appId = process.env.ADZUNA_APP_ID;
  var appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) { log('warn', 'Adzuna credentials not set - skipping'); return []; }
  try {
    var query = encodeURIComponent(profile.desired_roles[0] || 'marketing');
    var data = await fetchJSON('https://api.adzuna.com/v1/api/jobs/gb/search/1?app_id=' + appId + '&app_key=' + appKey + '&results_per_page=20&what=' + query);
    var jobs = (data.results || []).map(function(job) {
      return {
        source: 'Adzuna', title: job.title || '',
        company: (job.company && job.company.display_name) || 'Unknown',
        location: (job.location && job.location.display_name) || 'Unknown',
        url: job.redirect_url || '',
        description: (job.description || '').slice(0, 600)
      };
    });
    log('info', 'Adzuna: scraped ' + jobs.length + ' jobs');
    return jobs;
  } catch (e) { log('error', 'Adzuna failed: ' + e.message); return []; }
}

async function scrapeJobicy() {
  try {
    var query = encodeURIComponent(profile.desired_roles[0] || 'marketing');
    var data = await fetchJSON('https://jobicy.com/api/v2/remote-jobs?count=20&tag=' + query);
    var jobs = (data.jobs || []).map(function(job) {
      return {
        source: 'Jobicy', title: job.jobTitle || '',
        company: job.companyName || 'Unknown',
        location: job.jobGeo || 'Remote',
        url: job.url || '',
        description: (job.jobExcerpt || '').slice(0, 600)
      };
    });
    log('info', 'Jobicy: scraped ' + jobs.length + ' jobs');
    return jobs;
  } catch (e) { log('error', 'Jobicy failed: ' + e.message); return []; }
}

async function scrapeGreenhouse() {
  var companies = ['hubspot', 'canva', 'notion', 'figma', 'atlassian', 'monday', 'semrush'];
  var allJobs = [];
  for (var i = 0; i < companies.length; i++) {
    var company = companies[i];
    try {
      var data = await fetchJSON('https://api.greenhouse.io/v1/boards/' + company + '/jobs?content=true');
      var jobs = (data.jobs || []).filter(function(job) {
        var title = (job.title || '').toLowerCase();
        return profile.desired_roles.some(function(r) { return title.includes(r.toLowerCase().split(' ')[0]); });
      }).map(function(job) {
        return {
          source: 'Greenhouse',
          title: job.title || '',
          company: company.charAt(0).toUpperCase() + company.slice(1),
          location: (job.location && job.location.name) || 'Unknown',
          url: job.absolute_url || '',
          description: (job.content || '').replace(/<[^>]*>/g, '').slice(0, 600)
        };
      });
      allJobs = allJobs.concat(jobs);
    } catch (e) { log('warn', 'Greenhouse ' + company + ' failed: ' + e.message); }
  }
  log('info', 'Greenhouse: scraped ' + allJobs.length + ' jobs');
  return allJobs;
}

async function scrapeLever() {
  var companies = ['hotjar', 'typeform', 'contentful', 'personio', 'pendo'];
  var allJobs = [];
  for (var i = 0; i < companies.length; i++) {
    var company = companies[i];
    try {
      var data = await fetchJSON('https://api.lever.co/v0/postings/' + company + '?mode=json');
      var jobs = (Array.isArray(data) ? data : []).filter(function(job) {
        var title = (job.text || '').toLowerCase();
        return profile.desired_roles.some(function(r) { return title.includes(r.toLowerCase().split(' ')[0]); });
      }).map(function(job) {
        return {
          source: 'Lever',
          title: job.text || '',
          company: company.charAt(0).toUpperCase() + company.slice(1),
          location: (job.categories && job.categories.location) || job.workplaceType || 'Unknown',
          url: job.hostedUrl || '',
          description: (job.descriptionPlain || '').slice(0, 600)
        };
      });
      allJobs = allJobs.concat(jobs);
    } catch (e) { log('warn', 'Lever ' + company + ' failed: ' + e.message); }
  }
  log('info', 'Lever: scraped ' + allJobs.length + ' jobs');
  return allJobs;
}

function filterJobs(jobs) {
  var keywords = profile.desired_roles.map(function(r) { return r.toLowerCase(); });
  var exclude = ((profile.job_filters && profile.job_filters.exclude_keywords) || []).map(function(k) { return k.toLowerCase(); });
  var requireRemote = profile.job_filters && profile.job_filters.require_remote === true;
  return jobs.filter(function(job) {
    var title = job.title.toLowerCase();
    var desc = job.description.toLowerCase();
    var loc = job.location.toLowerCase();
    return keywords.some(function(kw) { return title.includes(kw) || desc.includes(kw); }) &&
      !exclude.some(function(kw) { return title.includes(kw); }) &&
      (!requireRemote || loc.includes('remote') || loc.includes('anywhere'));
  });
}

function generateCoverLetter(job) {
  var skillsList = Object.values(profile.skills || {}).flat().slice(0, 3).join(', ');
  return profile.cover_letter_template
    .replace('{role}', job.title).replace('{company}', job.company)
    .replace('{years}', profile.experience_years)
    .replace('{skills}', skillsList);
}

function sanitizeKey(val) {
  return (val || '').split('').filter(function(c) { return c.charCodeAt(0) > 31 && c.charCodeAt(0) < 127; }).join('').trim();
}

async function evaluateJobWithAI(job) {
  var apiKey = sanitizeKey(process.env.GROQ_API_KEY);
  if (!apiKey) {
    log('warn', 'GROQ_API_KEY not set - using default score');
    return { score: 70, cover_letter: generateCoverLetter(job) };
  }
  var skillsList = Object.values(profile.skills || {}).flat().slice(0, 5).join(', ');
  var promptText = 'Evaluate this job for a candidate with ' + profile.experience_years + ' year(s) experience skilled in ' + skillsList + '.\nTitle: ' + job.title + '\nCompany: ' + job.company + '\nDesc: ' + job.description.slice(0, 300) + '\nRespond ONLY as JSON: {"score":<0-100>}';
  var payload = JSON.stringify({
    model: 'llama3-8b-8192',
    messages: [{ role: 'user', content: promptText }],
    max_tokens: 60,
    temperature: 0.2
  });
  return new Promise(function(resolve) {
    var req = https.request({
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'Content-Length': Buffer.byteLength(payload)
      }
    }, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try {
          var result = JSON.parse(data);
          var content = JSON.parse((result.choices && result.choices[0] && result.choices[0].message && result.choices[0].message.content) || '{}');
          resolve({ score: content.score || 70, cover_letter: generateCoverLetter(job) });
        } catch (e) { resolve({ score: 70, cover_letter: generateCoverLetter(job) }); }
      });
    });
    req.on('error', function() { resolve({ score: 70, cover_letter: generateCoverLetter(job) }); });
    req.write(payload);
    req.end();
  });
}

async function sendEmailReport(applications, totalScraped) {
  var nodemailer = require('nodemailer');
  var transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
  });
  var today = new Date().toISOString().split('T')[0];
  var sourceColors = { Remotive: '#4a90e2', TheMuse: '#e24a90', Adzuna: '#2ecc71', Jobicy: '#e2904a', Greenhouse: '#9b59b6', Lever: '#1abc9c' };
  var rows = applications.map(function(app) {
    var bg = sourceColors[app.source] || '#ccc';
    return '<tr>' +
      '<td style="padding:8px;">' + app.title + '</td>' +
      '<td style="padding:8px;">' + app.company + '</td>' +
      '<td style="padding:8px;">' + app.location + '</td>' +
      '<td style="padding:8px;text-align:center;"><span style="background:' + bg + ';color:white;padding:2px 8px;border-radius:10px;font-size:11px;">' + app.source + '</span></td>' +
      '<td style="padding:8px;text-align:center;"><b>' + app.score + '/100</b></td>' +
      '<td style="padding:8px;"><a href="' + app.url + '">View</a></td>' +
      '</tr>';
  }).join('');
  var html = '<html><body style="font-family:Arial,sans-serif;max-width:800px;margin:auto;">' +
    '<div style="background:linear-gradient(135deg,#4a90e2,#7b68ee);padding:25px;border-radius:12px;color:white;text-align:center;">' +
    '<h1>Daily Job Report</h1><p>' + today + '</p></div>' +
    '<p><b>Jobs Scraped:</b> ' + totalScraped + ' | <b>Qualified Applications:</b> ' + applications.length + '</p>' +
    '<table style="width:100%;border-collapse:collapse;"><thead>' +
    '<tr style="background:#4a90e2;color:white;">