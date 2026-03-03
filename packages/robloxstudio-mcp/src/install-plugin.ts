import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { get } from 'https';
import { IncomingMessage } from 'http';

const REPO = 'boshyxd/robloxstudio-mcp';
const ASSET_NAME = 'MCPPlugin.rbxmx';

function getPluginsFolder(): string {
  if (process.platform === 'win32') {
    return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Roblox', 'Plugins');
  }
  return join(homedir(), 'Documents', 'Roblox', 'Plugins');
}

function httpsGet(url: string): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    get(url, { headers: { 'User-Agent': 'robloxstudio-mcp' } }, resolve).on('error', reject);
  });
}

async function download(url: string, dest: string): Promise<void> {
  const res = await httpsGet(url);

  if (res.statusCode === 301 || res.statusCode === 302) {
    const location = res.headers.location;
    if (!location) throw new Error('Redirect with no location header');
    return download(location, dest);
  }

  if (res.statusCode !== 200) {
    throw new Error(`Download failed: HTTP ${res.statusCode}`);
  }

  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest);
    res.pipe(file);
    file.on('finish', () => { file.close(); resolve(); });
    file.on('error', reject);
  });
}

export async function installPlugin(): Promise<void> {
  const pluginsFolder = getPluginsFolder();

  if (!existsSync(pluginsFolder)) {
    mkdirSync(pluginsFolder, { recursive: true });
  }

  console.log('Fetching latest release...');
  const res = await httpsGet(`https://api.github.com/repos/${REPO}/releases/latest`);

  const chunks: Buffer[] = [];
  for await (const chunk of res) {
    chunks.push(chunk as Buffer);
  }
  const release = JSON.parse(Buffer.concat(chunks).toString());

  const asset = release.assets?.find((a: { name: string }) => a.name === ASSET_NAME);
  if (!asset) {
    throw new Error(`${ASSET_NAME} not found in release ${release.tag_name}`);
  }

  const dest = join(pluginsFolder, ASSET_NAME);
  console.log(`Downloading ${ASSET_NAME} from ${release.tag_name}...`);
  await download(asset.browser_download_url, dest);
  console.log(`Installed to ${dest}`);
}
