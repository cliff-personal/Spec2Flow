# Bug Report Example

## Title
[Login] Submit button does not redirect after valid credentials

## Environment
- URL: http://localhost:3000/login
- Browser: Chromium
- Branch: main
- Date: 2026-03-23

## Reproduction Steps
1. Open the login page
2. Enter a valid username and password
3. Click the submit button

## Expected Result
User should be redirected to the dashboard.

## Actual Result
The page stays on the login screen and no success feedback is shown.

## Evidence
- Screenshot: `artifacts/login-submit-failure.png`
- Trace: `artifacts/trace.zip`
- Console error: `TypeError: Cannot read properties of undefined`