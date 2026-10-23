// Plan 6b-2, Task 0 (T6B2-NET-SPLIT): the network rule's ssh-family data, split out of autonomy-net.ts to keep it under 900
// lines. Data only: no logic. The option tables themselves (SSH_OPTS, SCP_OPTS, SFTP_OPTS) live in autonomy-tables.ts, where
// shell-words reads them too (T6B2-SSH-ONE-PARSER: one reading for every rule).
import { SCP_OPTS, SFTP_OPTS, SSH_OPTS, type OptTable } from './autonomy-tables.js';

// fix 1 (m3 ruling): the ssh `-o` keys the run may set. Any other key — ProxyCommand, LocalCommand, PermitLocalCommand,
// ProxyJump, `Match exec`, … — runs or changes a command on this machine whatever the host, so it is an unknown target.
export const SSH_O_ALLOW: ReadonlySet<string> = new Set(['stricthostkeychecking', 'userknownhostsfile', 'batchmode', 'connecttimeout', 'connectionattempts',
  'port', 'user', 'identityfile', 'identitiesonly', 'loglevel', 'serveraliveinterval', 'serveralivecountmax', 'compression', 'addkeystoagent', 'hostkeyalias',
  'preferredauthentications', 'passwordauthentication']);

// fix 2 (T6B2-SSH-FAILCLOSED): each tool's table and the options that run or reach outside the run (forwards, control/program
// paths, config files; fix 3: `-I`, a PKCS#11 library loaded as code). `-o`, `-J`, `-E` and `-O` (only `check` reads) carry
// their own value checks in autonomy-net.ts; any other option the table has allows, and one it lacks is an unknown target.
export const SSH_FAMILY: Readonly<Record<string, { table: OptTable; deny: ReadonlySet<string> }>> = {
  ssh: { table: SSH_OPTS, deny: new Set(['-F', '-S', '-L', '-R', '-D', '-w', '-W', '-s', '-I']) },
  scp: { table: SCP_OPTS, deny: new Set(['-F', '-S']) },
  sftp: { table: SFTP_OPTS, deny: new Set(['-F', '-S', '-D']) },
};

// The valued options of the netcat family and telnet, whose first operand is the host. ssh, scp and sftp are read with their
// full tables instead (fix 3, T6B2-SSH-ONE-PARSER).
export const NETCAT_VALUED: Readonly<Record<string, ReadonlySet<string>>> = {
  nc: new Set(['-p', '-s', '-w', '-X', '-x', '-b', '-q', '-i', '-O', '-T', '-g', '-G', '-m']),
  ncat: new Set(['-p', '-s', '-w', '-g', '-G', '-m', '-i', '-e', '-c']),
  telnet: new Set(['-b', '-l', '-n', '-e']),
};
