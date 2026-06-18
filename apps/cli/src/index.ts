#!/usr/bin/env node

import * as dotenv from 'dotenv';
import path from 'path';
import { program } from 'commander';
import { login } from './auth.js';
import { startInteractive } from './interactive.js';
import chalk from 'chalk';

// Load .env from the monorepo root
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

program
    .name('quozen')
    .description('CLI for Quozen decentralized expense sharing')
    .version('1.0.0')
    .action(async () => {
        try {
            await startInteractive();
        } catch (e: any) {
            console.error(chalk.red(`Error: ${e.message}`));
            process.exit(1);
        }
    });

program
    .command('login')
    .description('Log in to Google Drive via OAuth2')
    .action(async () => {
        try {
            await login();
        } catch (e: any) {
            console.error(chalk.red(`Login failed: ${e.message}`));
            process.exit(1);
        }
    });

program
    .command('dashboard')
    .description('Open interactive dashboard')
    .action(async () => {
        try {
            await startInteractive();
        } catch (e: any) {
            console.error(chalk.red(`Error: ${e.message}`));
            process.exit(1);
        }
    });

program
    .command('validate <groupId>')
    .description('Validate a Google Sheet against Quozen schema')
    .action(async (groupId) => {
        const { getQuozenCliClient } = await import('./quozen.js');
        try {
            const client = await getQuozenCliClient();
            console.log(chalk.blue(`Validating group: ${groupId}...`));
            const result = await client.groups.validateQuozenSpreadsheet(groupId);
            if (result.valid) {
                console.log(chalk.green(`Validation successful. Status: ${result.status}`));
            } else {
                console.log(chalk.red(`Validation failed: ${result.error}. Status: ${result.status}`));
            }
        } catch (e: any) {
            console.error(chalk.red(`Error: ${e.message}`));
        }
    });

program
    .command('metadata <groupId>')
    .description('Get all metadata for a file')
    .action(async (groupId) => {
        const { getQuozenCliClient } = await import('./quozen.js');
        try {
            const client = await getQuozenCliClient();
            console.log(chalk.blue(`Fetching metadata for: ${groupId}...`));
            const meta = await client.getFileMetadata(groupId);
            console.log(JSON.stringify(meta, null, 2));
        } catch (e: any) {
            console.error(chalk.red(`Error: ${e.message}`));
        }
    });

program
    .command('repair <groupId>')
    .description('Repair or migrate an out-of-sync or updatable group')
    .action(async (groupId) => {
        const { getQuozenCliClient } = await import('./quozen.js');
        try {
            const client = await getQuozenCliClient();
            console.log(chalk.blue(`Checking group: ${groupId}...`));
            const result = await client.groups.validateQuozenSpreadsheet(groupId);
            
            if (result.status === "UPDATABLE") {
                console.log(chalk.yellow(`Group is updatable. Running migrations...`));
                await client.groups.migrateGroup(groupId);
                console.log(chalk.green(`Migrations applied successfully.`));
            } else if (result.status === "OUT_OF_SYNC") {
                console.log(chalk.yellow(`Group is out of sync. Attempting repair...`));
                await client.groups.repairGroup(groupId);
                console.log(chalk.green(`Repair successful.`));
            } else {
                console.log(chalk.green(`Group is already up to date.`));
            }
        } catch (e: any) {
            console.error(chalk.red(`Error: ${e.message}`));
        }
    });

program.parseAsync(process.argv);
