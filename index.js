#!/usr/bin/env node

import { Command } from 'commander';
import { spawn } from 'child_process';
import readline from 'readline';
import chalk from 'chalk';
import ora from 'ora';
import axios from 'axios';
import { pathToFileURL } from 'url';

export const BACKEND_URL = process.env.HPORT_BACKEND_URL || 'https://h-lab-api.haiduong8592.workers.dev';
export const VERSION = '1.1.1';
export const DNS_EXISTS_CODE = 'DNS_EXISTS';
export const CLOUDFLARED_PROTOCOL = process.env.HPORT_CLOUDFLARED_PROTOCOL?.trim() || 'http2';
const DISPLAY_DOMAIN = process.env.HPORT_PUBLIC_BASE_DOMAIN?.trim() || 'Cloudflare Tunnel';
const BANNER_VERSION = `v${VERSION}`.padEnd(50);

export const UI = {
  divider() {
    console.log(chalk.gray('   ────────────────────────────────────────────────────────'));
  },
  displayBanner() {
    console.log(chalk.cyan.bold(`
   ╭────────────────────────────────────────────────────────╮
   │  H-PORT Tunnel                                          │
   │  Secure Localhost Exposure via ${DISPLAY_DOMAIN.padEnd(21)}│
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
    console.log(`   ${chalk.gray('Action:')} ${chalk.white('Replace the existing H-PORT-managed mapping with a new tunnel.')}\n`);
  },
  displaySuccess(url, target, replacedExisting) {
    console.log(`\n   ${chalk.green.bold('✔')} ${chalk.white(replacedExisting ? 'Tunnel is live and the previous H-PORT mapping was replaced.' : 'Tunnel is live!')}`);
    console.log(`   ${chalk.white('Public URL ')} ${chalk.underline.cyan(url)}`);
    console.log(`   ${chalk.white('Forward to ')} ${chalk.cyan(`http://${target}`)}\n`);
    console.log(`   ${chalk.gray('Control:')} ${chalk.yellow('Ctrl + C to terminate and cleanup current tunnel')}\n`);
  },
  displayBackground(pid) {
    console.log(chalk.gray(`   Background PID: ${pid || 'unknown'}`));
    console.log(chalk.gray('   Note: detached mode will not auto-clean on terminal close; use audit/cleanup if you stop it externally.'));
  },
  displayError(msg) {
    console.error(`\n   ${chalk.red.bold('✖ Error:')} ${chalk.white(msg)}\n`);
  }
};

export function checkCloudflared(spawnProcess = spawn) {
  return new Promise((resolve) => {
    const check = spawnProcess('cloudflared', ['--version']);
    check.on('error', () => resolve(false));
    check.on('close', (code) => resolve(code === 0));
  });
}

export function normalizeTarget(target) {
  return target.includes(':') ? target : `127.0.0.1:${target}`;
}

export function createTunnelPayload(subdomain, overwrite) {
  return {
    overwrite,
    subdomain: subdomain?.trim() || undefined
  };
}

export async function requestTunnel(
  subdomain,
  overwrite = false,
  { backendUrl = BACKEND_URL, httpClient = axios } = {}
) {
  const response = await httpClient.post(
    `${backendUrl}/create-tunnel`,
    createTunnelPayload(subdomain, overwrite)
  );

  if (!response.data.success) {
    throw new Error(response.data.error || 'Server rejected request');
  }

  return response.data;
}

export function askConfirmation(
  question,
  { stdin = process.stdin, stdout = process.stdout } = {}
) {
  if (!stdin.isTTY || !stdout.isTTY) {
    return Promise.resolve(false);
  }

  const rl = readline.createInterface({
    input: stdin,
    output: stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

export function handleTunnelOutput(chunk, onReady) {
  const msg = chunk.toString();
  if (msg.includes('Registered tunnel connection')) {
    onReady();
  }
}

export function createProgram({
  backendUrl = BACKEND_URL,
  httpClient = axios,
  spawnProcess = spawn,
  askUserConfirmation = askConfirmation,
  ui = UI,
  exitProcess = process.exit,
  registerSignalHandler = process.on.bind(process),
  removeSignalHandler = process.removeListener.bind(process)
} = {}) {
  return new Command()
    .name('hport')
    .description('Securely expose your localhost to the internet via Cloudflare Tunnel')
    .version(VERSION)
    .argument('<target>', 'Target port or IP:PORT (e.g., 8080 or 192.168.1.10:8080)')
    .option('-s, --subdomain <subdomain>', 'Custom subdomain')
    .option('-y, --yes', 'Automatically confirm reuse of an existing H-PORT-managed subdomain')
    .option('-b, --bg', 'Run cloudflared in the background and return immediately')
    .action(async (target, options) => {
      ui.displayBanner();

      const hasCloudflared = await checkCloudflared(spawnProcess);
      if (!hasCloudflared) {
        ui.displayError('Cloudflared not found!');
        console.log(chalk.yellow('   Please install cloudflared first:'));
        console.log(chalk.gray('   - Windows/Mac/Linux: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/setup/'));
        exitProcess(1);
        return;
      }

      const finalTarget = normalizeTarget(target);
      const requestedSubdomain = options.subdomain?.trim();
      ui.displayTarget(finalTarget, requestedSubdomain);

      const spinner = ora('Requesting secure tunnel...').start();
      let tunnelInfo = null;

      try {
        try {
          tunnelInfo = await requestTunnel(requestedSubdomain, false, { backendUrl, httpClient });
        } catch (err) {
          const conflictCode = err.response?.data?.code;
          if (conflictCode !== DNS_EXISTS_CODE) {
            throw err;
          }

          spinner.stop();
          ui.displayOverwritePrompt(
            err.response.data.subdomain,
            err.response.data.url || `https://${err.response.data.subdomain}`
          );

          const confirmed = options.yes || await askUserConfirmation(
            chalk.yellow('   Replace existing H-PORT mapping and continue? [y/N]: ')
          );
          if (!confirmed) {
            ui.displayError('Tunnel creation cancelled.');
            exitProcess(1);
            return;
          }

          spinner.start('Overwriting DNS and requesting secure tunnel...');
          tunnelInfo = await requestTunnel(requestedSubdomain, true, { backendUrl, httpClient });
        }

        spinner.succeed('Tunnel authorized.');

        const tunnelSpinner = ora('Connecting to H-Lab Edge...').start();
        let isLive = false;
        const spawnOptions = options.bg
          ? { detached: true, stdio: ['ignore', 'pipe', 'pipe'] }
          : undefined;
        const tunnelProcess = spawnProcess('cloudflared', [
          'tunnel', 'run', '--protocol', CLOUDFLARED_PROTOCOL, '--token', tunnelInfo.token, '--url', `http://${finalTarget}`
        ], spawnOptions);

        tunnelProcess.on('error', (err) => {
          if (err.spawnargs) err.spawnargs = ['[HIDDEN]'];
          if (err.args) err.args = ['[HIDDEN]'];

          tunnelSpinner.fail('Failed to start tunnel process.');
          ui.displayError(err.message);
          exitProcess(1);
        });

        const markAsLive = () => {
          if (!isLive) {
            isLive = true;
            tunnelSpinner.stop();
            ui.displaySuccess(tunnelInfo.url, finalTarget, tunnelInfo.replacedExisting);

            if (options.bg) {
              if (typeof tunnelProcess.stdout?.destroy === 'function') {
                tunnelProcess.stdout.destroy();
              }
              if (typeof tunnelProcess.stderr?.destroy === 'function') {
                tunnelProcess.stderr.destroy();
              }
              if (typeof tunnelProcess.unref === 'function') {
                tunnelProcess.unref();
              }
              ui.displayBackground(tunnelProcess.pid);
              exitProcess(0);
            }
          }
        };

        tunnelProcess.stderr?.on('data', (data) => handleTunnelOutput(data, markAsLive));
        tunnelProcess.stdout?.on('data', (data) => handleTunnelOutput(data, markAsLive));

        if (options.bg) {
          return;
        }

        let isCleaningUp = false;
        const cleanup = async () => {
          if (isCleaningUp) {
            return;
          }

          isCleaningUp = true;
          removeSignalHandler('SIGINT', cleanup);
          removeSignalHandler('SIGTERM', cleanup);
          console.log(chalk.yellow('\n\n   Cleaning up connection...'));
          tunnelProcess.kill();

          if (tunnelInfo) {
            try {
              await httpClient.delete(`${backendUrl}/cleanup`, {
                data: {
                  tunnelId: tunnelInfo.tunnelId,
                  dnsId: tunnelInfo.dnsId,
                  sessionId: tunnelInfo.sessionId
                }
              });
              console.log(chalk.green('   ✔ Subdomain released.'));
            } catch {
              // Silent fail on cleanup is acceptable
            }
          }
          exitProcess();
        };

        registerSignalHandler('SIGINT', cleanup);
        registerSignalHandler('SIGTERM', cleanup);
      } catch (err) {
        const errorMsg = err.response?.data?.error || err.message;
        spinner.fail(chalk.red('Connection failed'));
        console.log(chalk.gray(`   Reason: ${errorMsg}`));
        exitProcess(1);
      }
    });
}

export async function runCli(argv = process.argv, dependencies = {}) {
  const cli = createProgram(dependencies);
  await cli.parseAsync(argv);
}

const isDirectExecution = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  await runCli(process.argv);
}
