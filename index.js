#!/usr/bin/env node

import { program } from 'commander';
import { spawn } from 'child_process';
import readline from 'readline';
import chalk from 'chalk';
import ora from 'ora';
import axios from 'axios';

const BACKEND_URL = process.env.HPORT_BACKEND_URL || 'https://h-lab-api.haiduong8592.workers.dev';
const VERSION = '1.1.0';
const DNS_EXISTS_CODE = 'DNS_EXISTS';
const BANNER_VERSION = `v${VERSION}`.padEnd(50);

const UI = {
  divider() {
    console.log(chalk.gray('   ────────────────────────────────────────────────────────'));
  },
  displayBanner() {
    console.log(chalk.cyan.bold(`
   ╭────────────────────────────────────────────────────────╮
   │  H-PORT Tunnel                                          │
   │  Secure Localhost Exposure via hcu-lab.me               │
   │  ${BANNER_VERSION}│
   ╰────────────────────────────────────────────────────────╯`));
  },
  displayTarget(target, subdomain) {
    this.divider();
    console.log(`   ${chalk.white('Target    ')} ${chalk.cyan(`http://${target}`)}`);
    console.log(`   ${chalk.white('Subdomain ')} ${chalk.cyan(subdomain || '(auto-generate)')}`);
    this.divider();
  },
  displayOverwritePrompt(subdomain, url) {
    console.log(`\n   ${chalk.yellow.bold('!')} ${chalk.white(`Subdomain ${chalk.cyan(subdomain)} is already in use.`)}`);
    console.log(`   ${chalk.gray('Current public URL:')} ${chalk.underline.cyan(url)}`);
    console.log(`   ${chalk.gray('Action:')} ${chalk.white('Create a new tunnel and overwrite the existing DNS record.')}\n`);
  },
  displaySuccess(url, target, replacedExisting) {
    console.log(`\n   ${chalk.green.bold('✔')} ${chalk.white(replacedExisting ? 'Tunnel is live and DNS was overwritten.' : 'Tunnel is live!')}`);
    console.log(`   ${chalk.white('Public URL ')} ${chalk.underline.cyan(url)}`);
    console.log(`   ${chalk.white('Forward to ')} ${chalk.cyan(`http://${target}`)}\n`);
    console.log(`   ${chalk.gray('Control:')} ${chalk.yellow('Ctrl + C to terminate and cleanup current tunnel')}\n`);
  },
  displayError(msg) {
    console.error(`\n   ${chalk.red.bold('✖ Error:')} ${chalk.white(msg)}\n`);
  }
};

function checkCloudflared() {
  return new Promise((resolve) => {
    const check = spawn('cloudflared', ['--version']);
    check.on('error', () => resolve(false));
    check.on('close', (code) => resolve(code === 0));
  });
}

function normalizeTarget(target) {
  return target.includes(':') ? target : `127.0.0.1:${target}`;
}

function createTunnelPayload(subdomain, overwrite) {
  return {
    overwrite,
    subdomain: subdomain?.trim() || undefined
  };
}

async function requestTunnel(subdomain, overwrite = false) {
  const response = await axios.post(
    `${BACKEND_URL}/create-tunnel`,
    createTunnelPayload(subdomain, overwrite)
  );

  if (!response.data.success) {
    throw new Error(response.data.error || 'Server rejected request');
  }

  return response.data;
}

function askConfirmation(question) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return Promise.resolve(false);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

function handleTunnelOutput(chunk, onReady) {
  const msg = chunk.toString();
  if (msg.includes('Registered tunnel connection')) {
    onReady();
  }
}

program
  .name('hport')
  .description('Securely expose your localhost to the internet via hcu-lab.me')
  .version(VERSION)
  .argument('<target>', 'Target port or IP:PORT (e.g., 8080 or 192.168.1.10:8080)')
  .option('-s, --subdomain <subdomain>', 'Custom subdomain')
  .option('-y, --yes', 'Automatically confirm DNS overwrite when the subdomain already exists')
  .action(async (target, options) => {
    UI.displayBanner();

    const hasCloudflared = await checkCloudflared();
    if (!hasCloudflared) {
      UI.displayError('Cloudflared not found!');
      console.log(chalk.yellow('   Please install cloudflared first:'));
      console.log(chalk.gray('   - Windows/Mac/Linux: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/setup/'));
      process.exit(1);
    }

    const finalTarget = normalizeTarget(target);
    const requestedSubdomain = options.subdomain?.trim();
    UI.displayTarget(finalTarget, requestedSubdomain);

    const spinner = ora('Requesting secure tunnel...').start();
    let tunnelInfo = null;

    try {
      try {
        tunnelInfo = await requestTunnel(requestedSubdomain, false);
      } catch (err) {
        const conflictCode = err.response?.data?.code;
        if (conflictCode !== DNS_EXISTS_CODE) {
          throw err;
        }

        spinner.stop();
        UI.displayOverwritePrompt(
          err.response.data.subdomain,
          err.response.data.url || `https://${err.response.data.subdomain}.hcu-lab.me`
        );

        const confirmed = options.yes || await askConfirmation(chalk.yellow('   Overwrite existing DNS and continue? [y/N]: '));
        if (!confirmed) {
          UI.displayError('Tunnel creation cancelled.');
          process.exit(1);
        }

        spinner.start('Overwriting DNS and requesting secure tunnel...');
        tunnelInfo = await requestTunnel(requestedSubdomain, true);
      }
      
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

      const markAsLive = () => {
        if (!isLive) {
          isLive = true;
          tunnelSpinner.stop();
          UI.displaySuccess(tunnelInfo.url, finalTarget, tunnelInfo.replacedExisting);
        }
      };

      tunnelProcess.stderr.on('data', (data) => handleTunnelOutput(data, markAsLive));
      tunnelProcess.stdout.on('data', (data) => handleTunnelOutput(data, markAsLive));

      let isCleaningUp = false;
      const cleanup = async () => {
        if (isCleaningUp) {
          return;
        }

        isCleaningUp = true;
        console.log(chalk.yellow('\n\n   Cleaning up connection...'));
        tunnelProcess.kill();

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
