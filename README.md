# Fund Guru 📈

Fund Guru is a smart, modern mutual fund discovery and tracking platform built with React, Vite, and Firebase. It helps investors discover top-performing mutual funds, analyze risk-adjusted returns, and manage SIP portfolios with personalized recommendations.

## Features ✨
- **Smart Fund Explorer:** Browse and filter mutual funds by category, risk level, returns, expense ratio, and AUM.
- **Detailed Analytics:** View detailed fund metrics including Sharpe ratio, Sortino ratio, Alpha, Beta, and expense ratios.
- **SIP Tracker:** Manage your ongoing SIPs and receive personalized recommendations on whether to pause, stop, or continue investing in specific funds.
- **Data Synchronization:** Sync real-time mutual fund data and metadata securely using Firebase Data Synchronization (behind Admin Authentication).
- **Beautiful UI:** A responsive, glassmorphism-inspired dark/light theme built with Tailwind CSS, Shadcn UI, and Framer Motion.

## Tech Stack 🛠
- **Frontend:** React 18, TypeScript, Vite
- **Styling:** Tailwind CSS, Radix UI (Shadcn UI components)
- **State & Data Fetching:** React Query (@tanstack/react-query)
- **Backend & Database:** Firebase Auth & Firestore

## Setup & Running Locally 💻

1. **Install Dependencies:**
   ```bash
   pnpm install
   # or npm install
   ```

2. **Run Development Server:**
   ```bash
   pnpm dev
   # or npm run dev
   ```

3. **Build for Production:**
   ```bash
   pnpm build
   # or npm run build
   ```

## Admin Sync Functionality 🔄
To fetch and update mutual fund data manually, the application requires admin rights. The Firestore security rules are configured to permit write operations by specific admin emails.
- Go to the **Admin** page.
- Log in using an authorized Google account.
- Click **Refresh Data** to trigger an update.

## Deployment 🚀
This project is configured to automatically deploy to GitHub Pages upon pushing to the `main` branch.
