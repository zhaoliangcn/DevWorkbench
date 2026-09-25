import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'

export interface ApiConfig {
  enabled: boolean
  port: number
  apiKey: string
  host: string
}

const API_CONFIG_PATH = path.join(app.getPath('userData'), 'api-config.json')

function generateApiKey(): string {
  return crypto.randomBytes(32).toString('hex')
}

export function loadApiConfig(): ApiConfig {
  const defaultConfig: ApiConfig = {
    enabled: true,
    port: 3000,
    host: '127.0.0.1',
    apiKey: generateApiKey(),
  }

  try {
    if (fs.existsSync(API_CONFIG_PATH)) {
      const data = fs.readFileSync(API_CONFIG_PATH, 'utf-8')
      const saved = JSON.parse(data)
      return { ...defaultConfig, ...saved }
    }
  } catch {
    // ignore
  }

  saveApiConfig(defaultConfig)
  return defaultConfig
}

export function saveApiConfig(config: ApiConfig): void {
  try {
    fs.writeFileSync(API_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')
  } catch {
    // ignore
  }
}

export function getApiConfigPath(): string {
  return API_CONFIG_PATH
}
