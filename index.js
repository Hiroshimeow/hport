#!/usr/bin/env node

import { program } from 'commander';
import { spawn } from 'child_process';
import chalk from 'chalk';
import ora from 'ora';
import axios from 'axios';

const BACKEND_URL = 'https://h-lab-api.haiduong8592.workers.dev'; 

const UI = {
  displayBanner() {
    console.log(chalk.cyan.bold(`
   ╭────────────────────────────────────────────────────────╮
   │  H-PORT Tunnel - Secure Localhost Exposure             │
   ╰────────────────────────────────────────────────────────╯`));
  },
  displaySuccess(url, target) {
    console.log(`\n   ${chalk.green.bold('✔')} ${chalk.white('Tunnel is live!')}`);
    console.log(`   ${chalk.cyan.bold('👉')} ${chalk.underline.cyan(url)} ${chalk.gray('-->')} ${chalk.white(`http://${target}`)}\n`);
    console.log(chalk.gray('   Control: ') + chalk.yellow('Ctrl + C to terminate and cleanup subdomain\n'));
  }
};

program
  .name('hport')
  .alias('hcu')
  .description('Securely expose your localhost to the internet via hcu-lab.me')
  .version('1.0.0')
  .argument('<target>', 'Target port or IP:PORT (e.g., 8080 or 192.168.1.10:8080)')
  .option('-s, --subdomain <subdomain>', 'Custom subdomain')
  .action(async (target, options) => {
    UI.displayBanner();
    
    // Normalize target: default to localhost if only port is provided
    let finalTarget = target.includes(':') ? target : `127.0.0.1:${target}`;
    const spinner = ora('Requesting secure tunnel...').start();
    let tunnelInfo = null;

    try {
      // 1. Request tunnel authorization from backend
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

      // 2. Spawn cloudflared process using the received token
      const tunnelProcess = spawn('cloudflared', [
        'tunnel', 'run', '--token', tunnelInfo.token, '--url', `http://${finalTarget}`
      ]);

      tunnelProcess.stderr.on('data', (data) => {
        const msg = data.toString();
        // Look for the success message in cloudflared logs
        if (!isLive && msg.includes('Registered tunnel connection')) {
          isLive = true;
          tunnelSpinner.stop();
          UI.displaySuccess(tunnelInfo.url, finalTarget);
        }
      });

      // 3. Graceful shutdown and cleanup
      const cleanup = async () => {
        console.log(chalk.yellow('\n\n   Cleaning up connection...'));
        tunnelProcess.kill();
        if (tunnelInfo) {
          try {
            await axios.delete(`${BACKEND_URL}/cleanup`, {
              data: { tunnelId: tunnelInfo.tunnelId, dnsId: tunnelInfo.dnsId }
            });
            console.log(chalk.green('   ✔ Subdomain released.'));
          } catch (e) {
            // Cleanup failed silently on exit
          }
        }
        process.exit();
      };

      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);

    } catch (err) {
      const errorMsg = err.response?.data?.error || err.message;
      spinner.fail(chalk.red('Connection failed: ') + chalk.white(errorMsg));
      process.exit(1);
    }
  });

program.parse();
