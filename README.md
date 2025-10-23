# YouTube E2E Automation Test

This project is an end-to-end automated test for YouTube website(https://www.youtube.com), built with **Playwright** and **Node's built-in test runner ('node:test')**.

The test covers:
1. Searching for a video and atleast one result is returned
2. Playing and pausing (with ad skip handling)
3. Seeking/Skipping forward in the video
4. Taking a screenshot while the video is playing
5. Verifying the video title

---

## Pre-requisites

- [Node.js](https://nodejs.org/) v18+ (with built-in 'node:test')
- npm (comes with Node)

---

### Setup

1. Clone the repo:
   git clone https://github.com/denaeugeniopc/playwright-youtube-tests.git
   cd youtube-automation-test
2. Install dependencies (if needed):
   npm install
   npx playwright install 

#### Running the test
   npm run test:e2e

