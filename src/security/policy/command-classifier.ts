// Shell command classification (SECURITY.md §3). Commands are never SAFE because they look
// harmless: every command needs your OK in the confirmation window. This list only ESCALATES to
// BLOCKED, for things EngineBuddy must never do even if you click Allow: commands that destroy
// disks or backups, switch off security, hide what they really run, persist themselves, or go
// after credentials.
//
// Pattern matching can't prove a command safe, and it isn't asked to: a command that slips past
// this list still has to get past you.

export interface CommandVerdict {
  blocked: boolean;
  reason?: string;
}

interface Rule {
  pattern: RegExp;
  reason: string;
}

const DESTRUCTIVE = 'That could wipe a disk or your backups. Never doing that one.';
const SECURITY = "That switches off part of Windows' security. Not doing that.";
const HIDDEN = "That hides what it actually runs, so you couldn't check it. I won't run it.";
const PERSIST = "That would make something start by itself. That's not mine to set up.";
const SECRETS = 'That goes after passwords, keys or credentials. Not touching those. Ever.';

const RULES: Rule[] = [
  // Disks, boot, backups
  { pattern: /\bformat(\.com)?\s+[a-z]:/i, reason: DESTRUCTIVE },
  {
    pattern:
      /\b(format-volume|clear-disk|initialize-disk|remove-partition|diskpart|bcdedit|bootrec|bcdboot)\b/i,
    reason: DESTRUCTIVE,
  },
  { pattern: /\b(vssadmin|wbadmin)\b.*\bdelete\b/i, reason: DESTRUCTIVE },
  { pattern: /\bwmic\b.*\bshadowcopy\b.*\bdelete\b/i, reason: DESTRUCTIVE },
  { pattern: /\bcipher(\.exe)?\s+\/w/i, reason: DESTRUCTIVE },
  // Recursive deletes aimed at a drive root, Windows, or a user profile root
  {
    pattern:
      /\b(remove-item|rm|rmdir|rd|del|erase|ri)\b[^|;&\n]*(\s|["'])[a-z]:[\\/]?(windows|program files|users)?[\\/]?\*?(["']|\s|$)/i,
    reason: DESTRUCTIVE,
  },
  { pattern: /\brm\s+-[a-z]*r[a-z]*f?\s+\/(\s|$)/i, reason: DESTRUCTIVE },
  // Registry hives and security settings
  { pattern: /\breg(\.exe)?\s+(delete|add|import)\s+["']?(hklm|hkey_local_machine)/i, reason: SECURITY },
  { pattern: /\b(remove-item|set-itemproperty|new-itemproperty)\b[^|;\n]*hklm:/i, reason: SECURITY },
  { pattern: /\bset-mppreference\b[^|;\n]*-disable/i, reason: SECURITY },
  { pattern: /\badd-mppreference\b[^|;\n]*-exclusion/i, reason: SECURITY },
  {
    pattern: /\b(sc(\.exe)?|stop-service|set-service)\b[^|;\n]*\b(windefend|wscsvc|mpssvc|sense)\b/i,
    reason: SECURITY,
  },
  { pattern: /\bnetsh\b[^|;\n]*firewall[^|;\n]*\b(off|disable)\b/i, reason: SECURITY },
  { pattern: /\bset-netfirewallprofile\b[^|;\n]*-enabled\s+(\$?false|0)/i, reason: SECURITY },
  { pattern: /\benablelua\b/i, reason: SECURITY },
  { pattern: /\bset-executionpolicy\b/i, reason: SECURITY },
  // Hiding the real command
  { pattern: /\s-(e|ec|en|enc|enco|encod|encode|encoded|encodedc|encodedcommand)\s/i, reason: HIDDEN },
  { pattern: /\bfrombase64string\b/i, reason: HIDDEN },
  {
    pattern:
      /\b(iwr|irm|invoke-webrequest|invoke-restmethod|curl|wget|downloadstring|downloadfile|start-bitstransfer)\b[^\n]*\|\s*(iex|invoke-expression)\b/i,
    reason: HIDDEN,
  },
  {
    pattern:
      /\b(iex|invoke-expression)\b[^\n]*\b(iwr|irm|invoke-webrequest|invoke-restmethod|downloadstring|net\.webclient)\b/i,
    reason: HIDDEN,
  },
  // Persistence
  { pattern: /\bschtasks(\.exe)?\b[^|;\n]*\/create\b/i, reason: PERSIST },
  { pattern: /\bregister-scheduledtask\b/i, reason: PERSIST },
  { pattern: /currentversion\\run(once)?\b/i, reason: PERSIST },
  { pattern: /\\start menu\\programs\\startup\b/i, reason: PERSIST },
  { pattern: /\bnew-service\b|\bsc(\.exe)?\s+create\b/i, reason: PERSIST },
  // Credentials and secrets
  { pattern: /(^|[\\/\s"'~])\.(ssh|aws|azure|gnupg|kube)([\\/\s"']|$)/i, reason: SECRETS },
  { pattern: /\b(login data|web data|key4\.db|logins\.json|cookies\.sqlite)\b/i, reason: SECRETS },
  { pattern: /\\microsoft\\(credentials|protect|vault)\b/i, reason: SECRETS },
  { pattern: /\b(cmdkey|vaultcmd|mimikatz|procdump|lsass)\b/i, reason: SECRETS },
  { pattern: /\b(get-storedcredential|convertfrom-securestring)\b/i, reason: SECRETS },
  { pattern: /\.(kdbx|pfx|p12|ppk)\b/i, reason: SECRETS },
  { pattern: /\.git-credentials\b|\.npmrc\b|\.netrc\b|\.pypirc\b/i, reason: SECRETS },
  { pattern: /(^|[\\/\s"'])\.env(\.[\w.-]+)?([\s"'|;]|$)/i, reason: SECRETS },
  { pattern: /\.claude([\\/]|\.json\b)/i, reason: SECRETS },
  { pattern: /\bsystem32\\config\b/i, reason: SECRETS },
];

export function classifyCommand(command: string): CommandVerdict {
  const hit = RULES.find((r) => r.pattern.test(` ${command} `));
  return hit ? { blocked: true, reason: hit.reason } : { blocked: false };
}
