export function isMultiuserEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env?.MULTIUSER_ENABLED

  return typeof value === 'string' && value.trim().toLowerCase() === 'true'
}
