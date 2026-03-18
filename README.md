# BuildMatrix

BuildMatrix is a full-stack PC builder web application for creating, comparing, and saving custom computer builds. It includes user authentication, two-factor authentication, password reset, and saved builds for logged-in users.

## Features

- Interactive PC build creator
- Build comparison tools
- Auto Build suggestions
- User registration and login
- Two-factor authentication with recovery codes
- Password reset with email or development token fallback
- Saved builds for authenticated users
- Guest/localStorage fallback for non-logged-in users
- Dark mode support

## Tech Stack

- Frontend: HTML, CSS, Vanilla JavaScript
- Backend: Node.js, Express
- Database: SQLite using `sql.js`
- Authentication: `express-session`, `bcryptjs`, `speakeasy`

## Project Structure

- `public/` - frontend pages, scripts, styles, and images
- `server.js` - Express backend and API routes
- `sql/schema.sql` - optional SQLite schema reference
- `.env.example` - sample environment variables

## Setup Instructions

### 1) Install dependencies

```bash
npm install
```

### 2) Configure environment variables

Copy `.env.example` to `.env`.

```bash
cp .env.example .env
```

Then update values like `SESSION_SECRET` if needed.

### 3) Add image assets

Place the project image assets inside:

`public/Images`

### 4) Start the server

```bash
npm run dev
```

Open the app at:

`http://localhost:5000/`

## Notes

- The backend uses an embedded SQLite database file, so no MySQL installation is required.
- Logged-in users save builds in SQLite.
- Guest users can still use the builder, with saved data stored locally in the browser.
- If email credentials are not configured, password reset returns a development token for testing.

## Suggested Demo Flow

1. Open the Builder page
2. Register a new account
3. Log in and create a build
4. Save the build and open My Builds
5. Demonstrate 2FA setup or password reset
6. Explain that the project uses SQLite for local persistence
