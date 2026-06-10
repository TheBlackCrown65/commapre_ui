/**
 * k6 Load Test for Robot Verify — /api/v1/jobs/compare
 *
 * Prerequisites:
 *   1. Generate test data: python tests/generate_test_data.py --pages 10
 *   2. Update CONFIG below with your flow_id and API key
 *
 * Run:
 *   k6 run tests/load_test.js                          # default (1 user)
 *   k6 run tests/load_test.js --env SCENARIO=ramp      # ramp up to 10 users
 *   k6 run tests/load_test.js --env SCENARIO=stress    # stress test 30 users
 *   k6 run tests/load_test.js --env SCENARIO=single    # single request (debug)
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// ============================================================
// CONFIG — แก้ค่าตรงนี้ให้ตรงกับระบบของคุณ
// ============================================================
const CONFIG = {
    BASE_URL: __ENV.BASE_URL || 'http://localhost',
    API_KEY: __ENV.API_KEY || '',           // ← ใส่ API Key หรือ JWT token
    FLOW_ID: __ENV.FLOW_ID || '1',          // ← ใส่ flow_id ที่มี reference images
    ZIP_FILE: __ENV.ZIP_FILE || 'tests/test_data/test_10pages.zip',
};

// ============================================================
// CUSTOM METRICS
// ============================================================
const jobsQueued = new Counter('jobs_queued');
const jobsCompleted = new Counter('jobs_completed');
const jobsFailed = new Counter('jobs_failed');
const jobDuration = new Trend('job_processing_duration', true);
const successRate = new Rate('job_success_rate');

// ============================================================
// SCENARIOS
// ============================================================
const SCENARIOS = {
    // Default: 1 user, 3 iterations (สำหรับทดสอบว่าทำงานได้)
    default: {
        scenarios: {
            baseline: {
                executor: 'per-vu-iterations',
                vus: 1,
                iterations: 3,
                maxDuration: '10m',
            },
        },
    },

    // Single: 1 request (debug)
    single: {
        scenarios: {
            single: {
                executor: 'per-vu-iterations',
                vus: 1,
                iterations: 1,
                maxDuration: '10m',
            },
        },
    },

    // Ramp: ค่อยๆ เพิ่ม load จาก 1 → 10 users
    ramp: {
        scenarios: {
            ramp_up: {
                executor: 'ramping-vus',
                startVUs: 1,
                stages: [
                    { duration: '1m', target: 5 },
                    { duration: '2m', target: 10 },
                    { duration: '1m', target: 0 },
                ],
            },
        },
    },

    // Stress: จำลอง 30 flows พร้อมกัน (peak load test)
    stress: {
        scenarios: {
            stress: {
                executor: 'ramping-vus',
                startVUs: 1,
                stages: [
                    { duration: '30s', target: 10 },
                    { duration: '1m', target: 20 },
                    { duration: '1m', target: 30 },
                    { duration: '2m', target: 30 },
                    { duration: '30s', target: 0 },
                ],
            },
        },
    },
};

const selectedScenario = __ENV.SCENARIO || 'default';
export const options = SCENARIOS[selectedScenario] || SCENARIOS['default'];

// ============================================================
// HELPER: Login to get JWT token (if no API key)
// ============================================================
function getAuthToken() {
    if (CONFIG.API_KEY) {
        return CONFIG.API_KEY;
    }

    const loginRes = http.post(`${CONFIG.BASE_URL}/api/v1/auth/login`, JSON.stringify({
        username: __ENV.USERNAME || 'admin',
        password: __ENV.PASSWORD || 'admin',
    }), {
        headers: { 'Content-Type': 'application/json' },
    });

    if (loginRes.status === 200) {
        const body = JSON.parse(loginRes.body);
        return body.access_token;
    }

    console.error(`Login failed: ${loginRes.status} ${loginRes.body}`);
    return '';
}

// ============================================================
// HELPER: Poll job status until completed/failed
// ============================================================
function waitForJobCompletion(jobId, token, timeoutMs = 600000) {
    const startTime = Date.now();
    const pollInterval = 3; // seconds

    while (Date.now() - startTime < timeoutMs) {
        const statusRes = http.get(
            `${CONFIG.BASE_URL}/api/v1/jobs/${jobId}/status`,
            { headers: { 'Authorization': `Bearer ${token}` } }
        );

        if (statusRes.status === 200) {
            const data = JSON.parse(statusRes.body);

            if (data.status === 'COMPLETED') {
                return { success: true, status: 'COMPLETED', duration: Date.now() - startTime };
            }

            if (data.status === 'FAILED') {
                return { success: false, status: 'FAILED', duration: Date.now() - startTime, error: data.error_message };
            }
        }

        sleep(pollInterval);
    }

    return { success: false, status: 'TIMEOUT', duration: Date.now() - startTime };
}

// ============================================================
// SETUP: runs once before all VUs
// ============================================================
export function setup() {
    const token = getAuthToken();
    if (!token) {
        console.error('Failed to get auth token! Set API_KEY or USERNAME/PASSWORD env vars.');
    }

    // Verify ZIP file exists
    try {
        const zipData = open(CONFIG.ZIP_FILE, 'b');
        console.log(`ZIP file loaded: ${CONFIG.ZIP_FILE} (${zipData.length} bytes)`);
        return { token, zipSize: zipData.length };
    } catch (e) {
        console.error(`Cannot open ZIP file: ${CONFIG.ZIP_FILE}`);
        console.error('Run: python tests/generate_test_data.py --pages 10');
        return { token, zipSize: 0 };
    }
}

// ============================================================
// MAIN TEST FUNCTION: runs per VU iteration
// ============================================================
export default function (data) {
    if (!data.token || data.zipSize === 0) {
        console.error('Setup failed — skipping test');
        return;
    }

    const zipData = open(CONFIG.ZIP_FILE, 'b');

    // 1. Submit job
    const submitRes = http.post(
        `${CONFIG.BASE_URL}/api/v1/jobs/compare`,
        {
            flow_id: CONFIG.FLOW_ID,
            file: http.file(zipData, 'test_images.zip', 'application/zip'),
        },
        {
            headers: { 'Authorization': `Bearer ${data.token}` },
            timeout: '60s',
        }
    );

    const submitOk = check(submitRes, {
        'submit: status 200': (r) => r.status === 200,
        'submit: has job_id': (r) => {
            try { return JSON.parse(r.body).job_id !== undefined; }
            catch { return false; }
        },
    });

    if (!submitOk) {
        console.error(`Submit failed: ${submitRes.status} ${submitRes.body}`);
        jobsFailed.add(1);
        successRate.add(false);
        sleep(2);
        return;
    }

    const jobId = JSON.parse(submitRes.body).job_id;
    jobsQueued.add(1);
    console.log(`VU${__VU} iter${__ITER}: Job ${jobId} queued`);

    // 2. Poll until done
    const result = waitForJobCompletion(jobId, data.token);

    if (result.success) {
        jobsCompleted.add(1);
        successRate.add(true);
        jobDuration.add(result.duration);
        console.log(`VU${__VU}: Job ${jobId} COMPLETED in ${(result.duration / 1000).toFixed(1)}s`);
    } else {
        jobsFailed.add(1);
        successRate.add(false);
        jobDuration.add(result.duration);
        console.log(`VU${__VU}: Job ${jobId} ${result.status} after ${(result.duration / 1000).toFixed(1)}s`);
    }

    sleep(1);
}

// ============================================================
// TEARDOWN: runs once after all VUs
// ============================================================
export function teardown(data) {
    console.log('=== Load Test Complete ===');
}
