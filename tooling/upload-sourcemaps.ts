import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const browser = process.argv[2];
if (!browser) {
  console.error("Browser argument is missing.");
  process.exit(1);
}

const SOURCEMAPS_BASE_URL = process.env.SOURCEMAPS_BASE_URL || "https://better-lyrics-sourcemaps.dacubeking.com";
const SOURCEMAPS_API_KEY = process.env.SOURCEMAPS_API_KEY;

if (!SOURCEMAPS_API_KEY) {
  console.error("Missing SOURCEMAPS_API_KEY environment variable.");
  process.exit(1);
}

const packageJson = JSON.parse(fs.readFileSync("./package.json", "utf-8"));
const version = packageJson.version;
const gitHash = execSync("git rev-parse --short HEAD").toString().trim();
const versionWithHash = `${version}-${gitHash}`;

async function uploadFile(filePath: string) {
  const fileName = path.basename(filePath);
  const fileContent = fs.readFileSync(filePath);

  // Construct the URL: /<browser>/v<version>-<hash>/<filename>
  const url = `${SOURCEMAPS_BASE_URL}/${browser}/v${versionWithHash}/${fileName}`;

  try {
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-auth-token": SOURCEMAPS_API_KEY!,
        "User-Agent": "better-lyrics-ci/1.0",
      },
      body: fileContent,
    });

    if (!response.ok) {
      throw new Error(
        `Failed to upload ${fileName}: ${response.status} ${response.statusText} - ${await response.text()}`
      );
    }

    console.log(`Successfully uploaded ${fileName} to API.`);
  } catch (err) {
    console.error(`Error uploading ${fileName}:`, err);
    process.exit(1);
  }
}

function findFiles(dir: string, fileList: string[] = []) {
  const files = fs.readdirSync(dir);

  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      findFiles(filePath, fileList);
    } else {
      fileList.push(filePath);
    }
  });

  return fileList;
}

const sourcemapFiles = findFiles(`./sourcemaps_for_upload/${browser}`);
if (sourcemapFiles.length === 0) {
  console.warn(`Warning: No sourcemap files found for ${browser}`);
}

await Promise.all(sourcemapFiles.map(uploadFile)).catch(e => {
  console.error("Upload Failed", e);
  process.exit(1);
});
