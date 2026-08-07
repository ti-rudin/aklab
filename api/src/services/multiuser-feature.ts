export function isMultiuserEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env?.MULTIUSER_ENABLED === 'true'
}
