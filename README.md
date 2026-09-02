# Void

A social platform — Phase 1: auth, profiles, feed (posts/likes/comments), image uploads, and a Socket.io real-time foundation for messaging.

## Stack
- Node.js + Express
- PostgreSQL
- Socket.io (real-time chat foundation)
- Vanilla HTML/CSS/JS frontend (black & red theme)

## Local Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in your values:
   ```
   cp .env.example .env
   ```
   - `DATABASE_URL`: your PostgreSQL connection string
   - `JWT_SECRET`: any long random string

3. Initialize the database schema:
   ```
   npm run init-db
   ```

4. Start the server:
   ```
   npm run dev
   ```

   Visit `http://localhost:3000`

## Deploying to Render (via GitHub)

1. **Push this project to a GitHub repo.**

2. **Create a PostgreSQL database on Render:**
   - Dashboard → New → PostgreSQL
   - Once created, copy the "Internal Database URL"

3. **Create a Web Service on Render:**
   - Dashboard → New → Web Service
   - Connect your GitHub repo
   - Build Command: `npm install`
   - Start Command: `npm start`

4. **Set environment variables** on the Web Service (Settings → Environment):
   - `DATABASE_URL` = the Internal Database URL from step 2
   - `JWT_SECRET` = a long random string
   - `NODE_ENV` = `production`

5. **Initialize the database schema** — the easiest way is to run it once via Render's Shell tab on the web service:
   ```
   npm run init-db
   ```

6. Once deployed, your app will be live at the `.onrender.com` URL Render gives you.

## Notes
- Uploaded files are currently stored on local disk (`public/uploads`). Render's free/standard disks are **ephemeral** — files will be lost on redeploy. For production, swap the upload middleware to a persistent store (e.g. Render Disks add-on, or Cloudinary/S3) before going live.
- Phase 1 covers: auth, profile (pfp/cover upload), feed, likes, comments, follow/block/report, notifications, and the Socket.io real-time foundation.
- Phase 2+ (group chat, Void Premium, admin dashboard, Android wrapper) build on top of this foundation.
