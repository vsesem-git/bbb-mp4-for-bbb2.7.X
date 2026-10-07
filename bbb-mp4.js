const puppeteer = require('puppeteer');
const child_process = require('child_process');
const Xvfb = require('xvfb');

// Generate randome display port number to avoide xvfb failure
var disp_num = Math.floor(Math.random() * (200 - 99) + 99);
var xvfb = new Xvfb({
    displayNum: disp_num,
    silent: true,
    xvfb_args: ["-screen", "0", "1280x800x24", "-ac", "-nolisten", "tcp", "-dpi", "96", "+extension", "RANDR"]
});
var width = 1280;
var height = 800;
var options = {
    headless: false,
    args: [
        '--disable-infobars',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--start-fullscreen',
        '--app=https://www.google.com/',
        `--window-size=${width},${height}`,
    ],
}
options.executablePath = "/usr/bin/google-chrome"

// Emit a machine-readable status line that the web dashboard (or any other
// orchestrator) can parse from stdout/docker logs. Human-readable text is
// still logged alongside it for people tailing logs manually.
function stage(name, extra) {
    var payload = Object.assign({ stage: name, ts: new Date().toISOString() }, extra || {});
    console.log('STAGE:' + JSON.stringify(payload));
}

async function main() {
    let browser, page;
    try {
        stage('starting');
        xvfb.startSync()
        stage('xvfb-started', { display: disp_num });

        var url = process.argv[2];
        if (!url) {
            console.warn('URL undefined!');
            stage('error', { message: 'URL undefined' });
            process.exit(1);
        }
        // Validate URL
        var urlRegex = new RegExp('^https?:\\/\\/.*\\/playback\\/presentation\\/2\\.3\\/[a-z0-9]{40}-[0-9]{13}');
        if (!urlRegex.test(url)) {
            console.warn('Invalid recording URL for bbb 2.3!');
            console.warn(url)
            stage('error', { message: 'Invalid recording URL', url: url });
            process.exit(1);
        }

        // Set exportname
        var exportname = new URL(url).pathname.split("/")[4]
        console.log('EXPORT_NAME:' + exportname);

        // set duration to 0
        var duration = 0

        stage('launching-browser');
        browser = await puppeteer.launch(options)
        const pages = await browser.pages()

        page = pages[0]

        page.on('console', msg => {
            var m = msg.text();
            console.log('PAGE LOG:', m) // uncomment if you need
        });

        await page._client.send('Emulation.clearDeviceMetricsOverride')
        stage('opening-recording', { url: url });
        // Catch URL unreachable error
        await page.goto(url, { waitUntil: 'networkidle2' }).catch(e => {
            console.error('Recording URL unreachable!');
            stage('error', { message: 'Recording URL unreachable' });
            process.exit(2);
        })
        await page.setBypassCSP(true)

        // Check if recording exists (search "404" message)
        stage('checking-recording');
        await page.waitForTimeout(5 * 1000)
        try {
            var loadMsg = await page.$eval('.error-code', el => el.textContent);
            console.log(loadMsg)
            if (loadMsg == "404") {
                console.warn("Recording not found!");
                stage('error', { message: 'Recording not found (404)' });
                process.exit(1);
            }
        } catch (err) {
            console.log("Recording found")
        }

        // Get recording duration (fall back to any <video> element if the
        // expected video.js instance id differs between recordings)
        const recDuration = await page.evaluate(() => {
            var el = document.getElementById("vjs_video_3_html5_api") || document.querySelector('video');
            return el ? el.duration : 0;
        });
        duration = recDuration

        console.log('DURATION:' + duration)
        stage('duration-detected', { duration: duration });

        await page.waitForSelector('button[class=vjs-big-play-button]');
        await page.$eval('.bottom-content', element => element.style.display = "none");
        await page.$eval('.fullscreen-button', element => element.style.opacity = "0");
        await page.$eval('.right', element => element.style.opacity = "0");
        await page.$eval('.vjs-control-bar', element => element.style.opacity = "0");
        await page.click('button[class=vjs-big-play-button]', { waitUntil: 'domcontentloaded' });

        //  Start capturing screen with ffmpeg
        stage('capturing', { duration: duration });
        const ls = child_process.spawn('sh', ['ffmpeg-cmd.sh', ' ',
            `${duration}`, ' ',
            `${exportname}`, ' ',
            `${disp_num}`
        ], {
            shell: true
        });

        ls.stdout.on('data', (data) => {
            console.log(`stdout: ${data}`);
        });

        ls.stderr.on('data', (data) => {
            console.error(`stderr: ${data}`);
        });

        ls.on('close', (code) => {
            console.log(`child process exited with code ${code}`);
            stage('capture-finished', { exitCode: code });
        });

        await page.waitForTimeout(duration * 1000)
        stage('finalizing');
    } catch (err) {
        console.log(err)
        stage('error', { message: err && err.message ? err.message : String(err) });
    } finally {
        page && page.close && await page.close().catch(() => {})
        browser && browser.close && await browser.close().catch(() => {})
            // Stop xvfb after browser close
        xvfb.stopSync()
        stage('done');
    }
}

main()
