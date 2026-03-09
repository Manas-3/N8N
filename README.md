# 🤖 N8N Job Automation Agent

An **agentic workflow** that automatically scrapes job listings, evaluates fit using AI, generates tailored cover letters, and sends a daily email report — all powered by **n8n** and **GitHub Actions**.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    GitHub Actions (Daily 8AM UTC)               │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                    ┌──────▼──────┐
                    │  run_workflow│
                    │    .js      │
                    └──────┬──────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
   │  Remotive   │  │  The Muse   │  │   Adzuna    │
   │  API        │  │  API        │  │   API       │
   └──────┬──────┘  └──────┬──────┘  └──────┬──────┘
          └────────────────┼────────────────┘
                           │
                    ┌──────▼──────┐
                    │ Filter Jobs  │
                    │ by Profile   │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  OpenAI AI  │
                    │  Evaluator  │
                    │ (score/CL)  │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  Score ≥ 60?│
                    └──────┬──────┘
                           │ YES
                    ┌──────▼──────┐
                    │  Generate   │
                    │Cover Letter │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │ Email Report│
                    │ (SMTP/Gmail)│
                    └─────────────┘
```

---

## ✨ Features

| Feature | Description |
|---|---|
| 🔍 **Multi-source Scraping** | Remotive, The Muse, Adzuna APIs |
| 🧠 **AI Job Evaluation** | OpenAI GPT scores each job 0–100 |
| ✉️ **Tailored Cover Letters** | Auto-generated per job using your profile |
| 📧 **Daily Email Report** | HTML email with all applications & scores |
| ⚙️ **Configurable Profile** | JSON-based candidate preferences |
| 🔄 **GitHub Actions** | Fully automated — no server needed |
| 🧪 **Dry Run Mode** | Test without sending emails |

---

## 📁 Project Structure

```
N8N/
├── .github/
│   └── workflows/
│       └── job_automation.yml     # GitHub Actions workflow
├── config/
│   └── candidate_profile.json     # Your job preferences & skills
├── scripts/
│   └── run_workflow.js            # Standalone Node.js runner
├── workflows/
│   └── job_automation_agent.json  # Importable n8n workflow
├── reports/                       # Auto-generated reports (gitignored)
├── logs/                          # Execution logs (gitignored)
├── .env.example                   # Environment variable template
├── package.json
└── README.md
```

---

## 🚀 Setup

### Prerequisites
- Node.js 18+
- GitHub account
- OpenAI API key (optional but recommended)
- Gmail account with App Password

### 1️⃣ Clone the Repository
```bash
git clone https://github.com/Manas-3/N8N.git
cd N8N
npm install
```

### 2️⃣ Configure Your Profile
Edit `config/candidate_profile.json`:
```json
{
  "name": "Your Name",
  "desired_roles": ["Software Engineer", "Full Stack Developer"],
  "skills": ["JavaScript", "Python", "Node.js"],
  "experience_years": 3,
  "preferred_job_type": "remote",
  "salary_min": 80000
}
```

### 3️⃣ Set Up Environment Variables
```bash
cp .env.example .env
# Edit .env with your actual credentials
```

### 4️⃣ Add GitHub Secrets
Go to **Settings → Secrets and variables → Actions** and add:

| Secret | Description |
|---|---|
| `OPENAI_API_KEY` | OpenAI API key |
| `GMAIL_USER` | Your Gmail address |
| `GMAIL_APP_PASSWORD` | [Gmail App Password](https://support.google.com/accounts/answer/185833) |
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `587` |
| `REPORT_EMAIL_RECIPIENT` | Email to receive daily reports |
| `ADZUNA_APP_ID` | [Adzuna API](https://developer.adzuna.com/) App ID |
| `ADZUNA_APP_KEY` | Adzuna API Key |

---

## 🏃 Running Locally

```bash
# Normal run
npm start

# Dry run (no emails sent)
npm run dry-run

# With env vars
OPENAI_API_KEY=sk-... npm start
```

---

## 🔄 GitHub Actions

The workflow runs **automatically every day at 8 AM UTC**.

To trigger manually:
1. Go to **Actions** tab
2. Select **🤖 Job Automation Agent**
3. Click **Run workflow**
4. Optionally enable **dry run**

---

## 📊 Email Report Format

The daily HTML email includes:

```
📊 Daily Job Automation Report — 2026-03-09

📤 Applications Submitted: 5

┌──────────────────────┬──────────────┬──────────┬──────────┬──────┐
│ Title                │ Company      │ Location │ Score    │ Link │
├──────────────────────┼──────────────┼──────────┼──────────┼──────┤
│ Software Engineer    │ Acme Corp    │ Remote   │ 85/100   │ View │
│ Full Stack Developer │ StartupXYZ   │ Remote   │ 78/100   │ View │
└──────────────────────┴──────────────┴──────────┴──────────┴──────┘
```

---

## 🎛️ Customization

### Add More Job Sources
In `scripts/run_workflow.js`, add a new scraper function following the same pattern:
```js
async function scrapeNewSource() {
  const data = await fetchJSON('https://api.newsource.com/jobs');
  return data.jobs.map(job => ({ source: 'NewSource', title: job.title, ... }));
}
```

### Adjust Filters
In `config/candidate_profile.json`:
```json
{
  "job_filters": {
    "exclude_keywords": ["senior", "lead", "10+ years"],
    "min_ai_score": 70
  }
}
```

---

## 🛠️ Importing n8n Workflow

1. Open your n8n instance
2. Go to **Workflows → Import from file**
3. Upload `workflows/job_automation_agent.json`
4. Configure credentials (OpenAI, SMTP)
5. Activate the workflow

---

## 🔧 Troubleshooting

| Issue | Solution |
|---|---|
| `ADZUNA credentials not set` | Add `ADZUNA_APP_ID` and `ADZUNA_APP_KEY` to `.env` |
| `Failed to parse JSON` | Check API endpoints are accessible |
| Email not received | Verify Gmail App Password and enable IMAP |
| Low AI scores | Adjust `min_ai_score` in profile or broaden `desired_roles` |
| No jobs found | Loosen filters or add more `desired_roles` |

---

## 📄 License

MIT © [Manas-3](https://github.com/Manas-3)