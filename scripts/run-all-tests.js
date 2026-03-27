import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const isNonInteractive = args.includes('--non-interactive');

const colors = {
    reset: "\x1b[0m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
    bold: "\x1b[1m"
};

const tasks = [
    { name: "TypeScript Check", cmd: "npm", args: ["run", "check"] },
    { name: "Unit & Integration Tests", cmd: "npm", args: ["run", "test"] },
    { name: "Core LLM Behavior", cmd: "npm", args: ["run", "test:ai:llm-behavior", "--workspace=@quozen/core"] },
    { name: "Playwright E2E Tests", cmd: "npm", args: ["run", "test:e2e", "--workspace=@quozen/webapp"] }
];

if (!isNonInteractive) {
    tasks.push({
        name: "Live Infrastructure Smoke Test",
        cmd: "npm",
        args: ["run", "test:ai:live-smoke-test", "--workspace=@quozen/core"]
    });
}

console.log(`${colors.bold}${colors.cyan}🚀 Starting Quozen Pre-Deployment Test Suite${colors.reset}`);

const results = [];
let hasFailures = false;

for (const task of tasks) {
    console.log(`${colors.yellow}▶ Running: ${task.name}...${colors.reset}`);

    const result = spawnSync(task.cmd, task.args, {
        stdio: 'inherit',
        shell: true
    });

    const success = result.status === 0;
    results.push({
        Task: task.name,
        Status: success ? '✅ PASS' : '❌ FAIL'
    });

    if (!success) {
        hasFailures = true;
        console.log(`${colors.red}${colors.bold}✖ Task failed: ${task.name}. Aborting subsequent tests to save time.${colors.reset}`);
        break; // Fail-fast: Don't run heavy E2E if basic TS checks or unit tests fail
    } else {
        console.log(`${colors.green}✔ Passed: ${task.name}${colors.reset}`);
    }
}

console.log(`${colors.bold}${colors.cyan}📊 Pre-Deployment Summary${colors.reset}`);
console.table(results);

if (hasFailures) {
    console.log(`${colors.red}${colors.bold}❌ Pre-deployment checks failed. Please fix the errors above before merging.${colors.reset}`);
    process.exit(1);
} else {
    console.log(`${colors.green}${colors.bold}✅ All checks passed! You are ready to deploy.${colors.reset}`);
    process.exit(0);
}
