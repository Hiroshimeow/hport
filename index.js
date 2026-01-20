#!/usr/bin/env node

import { program } from 'commander';
import { spawn } from 'child_process';
import chalk from 'chalk';
import ora from 'ora';
import axios from 'axios';
import fs from 'fs';

// Cấu hình
const BACKEND_URL = 'https://h-lab-api.haiduong8592.workers.dev'; 
const VERSION = '1.0.1'; // Bump version

const UI = {
  displayBanner() {
    console.log(chalk.cyan.bold(`
   ╭────────────────────────────────────────────────────────╮
   │  H-PORT Tunnel - Secure Localhost Exposure             │
   │  v${VERSION}                                             │
   ╰────────────────────────────────────────────────────────╯`));
  },
  displaySuccess(url, target) {
    console.log(`\n   ${chalk.green.bold('✔')} ${chalk.white('Tunnel is live!')}`);
    console.log(`   ${chalk.cyan.bold('👉')} ${chalk.underline.cyan(url)} ${chalk.gray('-->')} ${chalk.white(`http://${target}`)}\n`);
    console.log(chalk.gray('   Control: ') + chalk.yellow('Ctrl + C to terminate and cleanup subdomain\n'));
  },
  displayError(msg) {
    console.error(`\n   ${chalk.red.bold('✖ Error:')} ${chalk.white(msg)}\n`);
  }
};

// Hàm kiểm tra cloudflared có tồn tại không
const checkCloudflared = () => {
  return new Promise((resolve) => {
    const check = spawn('cloudflared', ['--version']);
    check.on('error', () => resolve(false));
    check.on('close', (code) => resolve(code === 0));
  });
};

program
  .name('hport')
  .description('Securely expose your localhost to the internet via hcu-lab.me')
  .version(VERSION)
  .argument('<target>', 'Target port or IP:PORT (e.g., 8080 or 192.168.1.10:8080)')
  .option('-s, --subdomain <subdomain>', 'Custom subdomain')
  .action(async (target, options) => {
    UI.displayBanner();

    // 1. Pre-check: Cloudflared installation
    const hasCloudflared = await checkCloudflared();
    if (!hasCloudflared) {
      UI.displayError('Cloudflared not found!');
      console.log(chalk.yellow('   Please install cloudflared first:'));
      console.log(chalk.gray('   - Windows/Mac/Linux: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/setup/'));
      process.exit(1);
    }
    
    // Normalize target
    let finalTarget = target.includes(':') ? target : `127.0.0.1:${target}`;
    const spinner = ora('Requesting secure tunnel...').start();
    let tunnelInfo = null;

    try {
      // 2. Request tunnel authorization
      const response = await axios.post(`${BACKEND_URL}/create-tunnel`, {
        subdomain: options.subdomain
      });

      if (!response.data.success) {
        throw new Error(response.data.error || 'Server rejected request');
      }

      tunnelInfo = response.data;
      spinner.succeed('Tunnel authorized.');

      const tunnelSpinner = ora('Connecting to H-Lab Edge...').start();
      let isLive = false;

      // 3. Spawn cloudflared process SECURELY
      const tunnelProcess = spawn('cloudflared', [
        'tunnel', 'run', '--token', tunnelInfo.token, '--url', `http://${finalTarget}`
      ]);

      // --- SECURITY FIX: PREVENT TOKEN LEAK ON ERROR ---
      tunnelProcess.on('error', (err) => {
        // CRITICAL: Delete arguments containing token before logging
        if (err.spawnargs) err.spawnargs = ['[HIDDEN]']; 
        if (err.args) err.args = ['[HIDDEN]'];
        
        tunnelSpinner.fail('Failed to start tunnel process.');
        // Chỉ hiện message lỗi cơ bản, không hiện stack trace chứa tham số
        UI.displayError(err.message);
        process.exit(1);
      });
      // -------------------------------------------------

      tunnelProcess.stderr.on('data', (data) => {
        const msg = data.toString();
        if (!isLive && msg.includes('Registered tunnel connection')) {
          isLive = true;
          tunnelSpinner.stop();
          UI.displaySuccess(tunnelInfo.url, finalTarget);
        }
      });

      // 4. Graceful shutdown
      const cleanup = async () => {
        console.log(chalk.yellow('\n\n   Cleaning up connection...'));
        tunnelProcess.kill(); // Kill child process first
        
        if (tunnelInfo) {
          try {
            await axios.delete(`${BACKEND_URL}/cleanup`, {
              data: { tunnelId: tunnelInfo.tunnelId, dnsId: tunnelInfo.dnsId }
            });
            console.log(chalk.green('   ✔ Subdomain released.'));
          } catch (e) {
            // Silent fail on cleanup is acceptable
          }
        }
        process.exit();
      };

      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);

    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message;
      spinner.fail(chalk.red('Connection failed'));
      console.log(chalk.gray(`   Reason: ${errorMsg}`));
      process.exit(1);
    }
  });

program.parse();
