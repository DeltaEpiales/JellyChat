const puppeteer = require('puppeteer');
const { PuppeteerScreenRecorder } = require('puppeteer-screen-recorder');
const path = require('path');

(async () => {
    // 1. Launch browser in a specific layout format (forcing dark mode / desktop scale)
    const browser = await puppeteer.launch({
        headless: false, // Set to false so you can watch it execute
        defaultViewport: { width: 1920, height: 1080 },
        args: ['--start-maximized', '--force-dark-mode']
    });

    const page = await browser.newPage();

    // Update this URL to point to your active node frontend development server
    const APP_URL = 'http://192.168.4.38:5173';
    await page.goto(APP_URL, { waitUntil: 'networkidle2' });

    // 2. Configure the Video Recorder Output
    const outputVideoPath = path.join(__dirname, 'jellychat_demo.mp4');
    const recorderConfig = {
        followNewTab: false,
        fps: 60,
        ffmpeg_Path: null, // Pulls automatically from system PATH if available
        videoFrame: {
            width: 1920,
            height: 1080,
        },
        videoCrf: 18, // High-quality visually lossless recording
        videoBitrate: 4000,
    };

    const recorder = new PuppeteerScreenRecorder(page, recorderConfig);
    console.log('🎥 Starting automated video capture...');
    await recorder.start(outputVideoPath);

    // Helper utility to simulate natural human typing delays
    async function typeLikeHuman(selector, text) {
        await page.waitForSelector(selector);
        await page.focus(selector);
        for (const char of text) {
            await page.type(selector, char, { delay: Math.floor(Math.random() * 40) + 30 });
        }
    }

    try {
        // --- SCENE 1: Welcome & Interface Overview ---
        console.log('🎬 Recording Scene 1: Main Dashboard Overview...');
        await page.waitForTimeout(3000); // Hold on initial layout view

        // --- SCENE 2: Multi-Agent AI System ---
        console.log('🎬 Recording Scene 2: Interacting with AI Agents...');
        const chatInputSelector = 'textarea[placeholder*="Message"]';

        // Type out the multi-agent invocation prompt
        await typeLikeHuman(chatInputSelector, '@mimir @jarvis hello - this is a multi agent test - what can you do?');
        await page.waitForTimeout(1000);

        // Press Enter to submit the message prompt
        await page.keyboard.press('Enter');

        // Wait for the simulated websocket response streaming mechanics to complete
        await page.waitForTimeout(12000);

        // --- SCENE 3: UI Theming Integration ---
        console.log('🎬 Recording Scene 3: Cycling Theme Accents...');

        // Click Settings Menu button to reveal configuration options
        const settingsBtnSelector = 'button[title="App Settings"]';
        await page.waitForSelector(settingsBtnSelector);
        await page.click(settingsBtnSelector);
        await page.waitForTimeout(1000);

        // Dynamic array targeting theme choice selectors inside the layout model window
        // Modify these selectors based on your specific modal implementation details
        const themes = ['sunset', 'ocean', 'forest', 'jelly'];
        for (const theme of themes) {
            console.log(`Switching theme variant to: ${theme}`);
            // Assumes your buttons have custom datasets or text contents match
            const themeBtn = await page.waitForSelector(`button[data-theme="${theme}"], button:text("${theme}")`);
            await themeBtn.click();
            await page.waitForTimeout(2000); // Pause briefly to catch the glow transition transition
        }

        // Close settings pane modal component frame 
        await page.keyboard.press('Escape');
        await page.waitForTimeout(1000);

        // --- SCENE 4: Game Servers Tab discovery ---
        console.log('🎬 Recording Scene 4: Checking Game Servers browser panel...');
        const gameServerBtnSelector = 'button:has-text("Game Servers")';
        // Fallback: use exact text content find strategy if class matches or position is known
        await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const gameBtn = buttons.find(b => b.textContent.includes('Game Servers'));
            if (gameBtn) gameBtn.click();
        });

        await page.waitForTimeout(4000); // Hold view to show the active server listing grid layout

    } catch (error) {
        console.error('❌ Automation sequence runtime failure:', error);
    } finally {
        // 3. Clean up records safely
        console.log('🏁 Finalizing capture sequences. Saving output video structure...');
        await recorder.stop();
        await browser.close();
        console.log(`🎉 Demo video successfully written locally to: ${outputVideoPath}`);
    }
})();