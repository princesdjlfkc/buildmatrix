# BuildMatrix Backend (No MySQL Needed)

This version uses an embedded SQLite database file (`buildmatrix.sqlite`) via `sql.js`, so you can open/run the system anytime without installing MySQL.

## Run (PowerShell)

1) Open PowerShell in the project folder
2) Install dependencies:
   ```powershell
   npm install
   ```
3) Start server:
   ```powershell
   npm start
   ```
4) Open:
   - http://localhost:5000/

## Database file
- `buildmatrix.sqlite` will be created automatically in the project root.
- Delete it if you want a fresh database.

## API
- Register: `POST /api/auth/register`
- Login: `POST /api/auth/login`
- Forgot Password: `POST /api/auth/forgot-password`
- Reset Password: `POST /api/auth/reset-password`
- 2FA: `/api/2fa/*`
- Builds: `/api/builds*`
