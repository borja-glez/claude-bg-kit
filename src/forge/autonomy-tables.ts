// Plan 6b-1, Task 4 (fix 4, FC3): the known-option tables of every bash write-class command, from GNU coreutils and each
// tool's manual, and the one scanner that reads a segment's words with them. One table answers both «is this option
// known» and «does it take a value»; an option outside it cancels every exemption of the segment (autonomy-parse.ts),
// the way PowerShell's cmdlet tables already do. Pure data and string reading: no file, no process, no imports.
import type { Dialect, Word } from './shell-words.js';

/**
 * How an option takes its value: a switch (`w`); a value glued or in the next word (`v`); a glued value only (`g`:
 * sed -i, perl -M, `--backup[=CONTROL]`); glued octal digits only (`o`: perl -0 / -l); every following word that is not
 * an option (`m`: robocopy /XD, unzip -x, find -exec).
 */
export type OptKind = 'w' | 'v' | 'g' | 'o' | 'm';

export interface OptTable {
  /** `-x`, `--long`, `-long` (find's predicates, wget's -nv), `/switch` and `/switch:` (cmd, robocopy) or `+x` (attrib) keys. */
  readonly opts: Readonly<Record<string, OptKind>>;
  /** 7z: a switch is the longest key that prefixes the word, the rest of the word its glued value. */
  readonly prefix?: boolean;
  /** curl, rsync: `--no-<switch>` is known when `--<switch>` is. */
  readonly noPrefix?: boolean;
}

/**
 * A table from a space-separated spec: a trailing `=` takes a value, `?` a glued value only, `#` glued octal, `+` the
 * following words; a `/switch:` key takes its value glued after the colon. A two-character token (`-#`, `-:`, `+r`) is a key as is.
 */
export function T(spec: string, extra: Omit<OptTable, 'opts'> = {}): OptTable {
  const opts: Record<string, OptKind> = {};
  for (const tok of spec.split(/\s+/).filter(Boolean)) {
    const mark = tok.length > 2 && /[=?#+]$/.test(tok) ? tok.slice(-1) : '';
    const key = mark ? tok.slice(0, -1) : tok;
    const kind: OptKind = mark === '=' ? 'v' : mark === '?' ? 'g' : mark === '#' ? 'o' : mark === '+' ? 'm' : key.startsWith('/') && key.endsWith(':') ? 'g' : 'w';
    opts[key.startsWith('/') || key.startsWith('+') ? key.toLowerCase() : key] = kind;
  }
  return { opts, ...extra };
}

const COREUTILS_COMMON = '--help --version';
const CHMOD_LIKE = `-c --changes -f --silent --quiet -v --verbose --no-preserve-root --preserve-root --reference= -R --recursive -H -L -P ${COREUTILS_COMMON}`;
// tar's long options, all of GNU tar 1.35 (modes, archive and directory, compression, selection, attributes, informative).
const TAR_LONG = `--catenate --concatenate --create --diff --compare --delete --append --list --test-label --update --extract --get
  --check-device --no-check-device --listed-incremental= --hole-detection= --incremental --ignore-failed-read --level= --seek --no-seek --sparse-version= --sparse
  --no-auto-compress --use-compress-program= --gzip --gunzip --ungzip --bzip2 --xz --lzip --lzma --lzop --zstd --compress --uncompress --auto-compress
  --exclude= --exclude-from= --exclude-vcs --exclude-vcs-ignores --exclude-backups --exclude-caches --exclude-caches-all --exclude-caches-under --exclude-tag=
  --exclude-tag-all= --exclude-tag-under= --exclude-ignore= --exclude-ignore-recursive= --strip-components= --transform= --xform= --wildcards --no-wildcards
  --anchored --no-anchored --ignore-case --no-ignore-case --wildcards-match-slash --no-wildcards-match-slash --keep-old-files --skip-old-files --overwrite
  --overwrite-dir --no-overwrite-dir --keep-newer-files --keep-directory-symlink --unlink-first --recursive-unlink --remove-files --touch --preserve-permissions
  --same-permissions --no-same-permissions --same-owner --no-same-owner --numeric-owner --owner= --group= --mode= --mtime= --clamp-mtime --atime-preserve?
  --delay-directory-restore --no-delay-directory-restore --absolute-names --dereference --hard-dereference --one-file-system --no-recursion --recursion
  --newer= --after-date= --newer-mtime= --totals? --checkpoint? --checkpoint-action= --index-file= --show-transformed-names --show-stored-names --show-defaults
  --show-omitted-dirs --show-snapshot-field-ranges --format= --posix --pax-option= --label= --blocking-factor= --record-size= --read-full-records --ignore-zeros
  --ignore-command-error --no-ignore-command-error --warning= --interactive --confirmation --occurrence? --files-from= --null --no-null --verbatim-files-from
  --no-verbatim-files-from --unquote --no-unquote --add-file= --backup? --suffix= --to-stdout --to-command= --help --usage --version --force-local --rsh-command=
  --rmt-command= --info-script= --new-volume-script= --multi-volume --tape-length= --acls --no-acls --selinux --no-selinux --xattrs --no-xattrs --xattrs-exclude=
  --xattrs-include= --quoting-style= --quote-chars= --no-quote-chars= --full-time --utc --sort= --starting-file= --preserve-order --same-order --preserve
  --block-number --old-archive --portability --pax --ustar --gnu --oldgnu --v7 --one-top-level? --group-map= --owner-map= --verify --verbose --file= --directory=
  --check-links --lz4`;
const TAR_SHORT = '-A -c -d -r -t -u -x -f= -C= -T= -X= -g= -F= -I= -K= -L= -N= -V= -b= -H= -W -O -P -S -U -Z -a -h -i -j -J -k -l -m -n -o -p -s -v -w -z -B -G -M -R';
// find's predicates (findutils 4.9): tests take one value, actions their file, -exec its command words (Task 1 splits those out).
const FIND_NEWER = ['a', 'B', 'c', 'm'].flatMap(x => ['a', 'B', 'c', 'm', 't'].map(y => `-newer${x}${y}=`)).join(' ');
const FIND = `-H -L -P -D= -O? -d -depth -maxdepth= -mindepth= -mount -xdev -noleaf -ignore_readdir_race -noignore_readdir_race -daystart -follow -regextype=
  -warn -nowarn -files0-from= -amin= -anewer= -atime= -cmin= -cnewer= -ctime= -mmin= -mtime= -newer= ${FIND_NEWER} -empty -executable -readable -writable -false -true
  -fstype= -gid= -group= -uid= -user= -nouser -nogroup -ilname= -iname= -inum= -ipath= -iregex= -iwholename= -links= -lname= -name= -path= -perm= -regex= -samefile=
  -size= -type= -xtype= -used= -wholename= -context= -delete -exec+ -execdir+ -ok+ -okdir+ -fls= -fprint= -fprint0= -fprintf+ -ls -print -print0 -printf= -prune -quit
  -a -and -o -or -not -help --help -version --version`;
// curl 8.x: every option of the manual; the ones that name a file curl writes are read by autonomy-parse.ts (CURL_OUT).
const CURL = `-a -A= -b= -B -c= -C= -d= -D= -e= -E= -f -F= -g -G -h? -H= -i -I -j -J -k -K= -l -L -m= -M -n -N -o= -O -p -P= -q -Q= -r= -R -s -S -t= -T= -u= -U= -v -V
  -w= -x= -X= -y= -Y= -z= -Z -: -# -0 -1 -2 -3 -4 -6
  --abstract-unix-socket= --alt-svc= --anyauth --append --aws-sigv4= --basic --ca-native --cacert= --capath= --cert= --cert-status --cert-type= --ciphers= --compressed
  --compressed-ssh --config= --connect-timeout= --connect-to= --continue-at= --cookie= --cookie-jar= --create-dirs --create-file-mode= --crlf --crlfile= --curves= --data=
  --data-ascii= --data-binary= --data-raw= --data-urlencode= --delegation= --digest --disable --disable-eprt --disable-epsv --disallow-username-in-url --dns-interface=
  --dns-ipv4-addr= --dns-ipv6-addr= --dns-servers= --doh-cert-status --doh-insecure --doh-url= --dump-ca-embed --dump-header= --ecdh-curves= --egd-file= --engine=
  --etag-compare= --etag-save= --expect100-timeout= --fail --fail-early --fail-with-body --false-start --form= --form-escape --form-string= --ftp-account=
  --ftp-alternative-to-user= --ftp-create-dirs --ftp-method= --ftp-pasv --ftp-port= --ftp-pret --ftp-skip-pasv-ip --ftp-ssl-ccc --ftp-ssl-ccc-mode= --ftp-ssl-control --get
  --globoff --happy-eyeballs-timeout-ms= --haproxy-clientip= --haproxy-protocol --head --header= --help? --hostpubmd5= --hostpubsha256= --hsts= --http0.9 --http1.0 --http1.1
  --http2 --http2-prior-knowledge --http3 --http3-only --ignore-content-length --include --insecure --interface= --ip-tos= --ipfs-gateway= --ipv4 --ipv6 --json=
  --junk-session-cookies --keepalive-time= --key= --key-type= --krb= --libcurl= --limit-rate= --list-only --local-port= --location --location-trusted --login-options=
  --mail-auth= --mail-from= --mail-rcpt= --mail-rcpt-allowfails --manual --max-filesize= --max-redirs= --max-time= --metalink --mptcp --negotiate --netrc --netrc-file=
  --netrc-optional --next --no-alpn --no-buffer --no-clobber --no-keepalive --no-npn --no-progress-meter --no-sessionid --noproxy= --ntlm --ntlm-wb --oauth2-bearer=
  --output= --output-dir= --parallel --parallel-immediate --parallel-max= --pass= --path-as-is --pinnedpubkey= --post301 --post302 --post303 --preproxy= --progress-bar
  --proto= --proto-default= --proto-redir= --proxy= --proxy-anyauth --proxy-basic --proxy-ca-native --proxy-cacert= --proxy-capath= --proxy-cert= --proxy-cert-type=
  --proxy-ciphers= --proxy-crlfile= --proxy-digest --proxy-header= --proxy-http2 --proxy-insecure --proxy-key= --proxy-key-type= --proxy-negotiate --proxy-ntlm --proxy-pass=
  --proxy-pinnedpubkey= --proxy-service-name= --proxy-ssl-allow-beast --proxy-ssl-auto-client-cert --proxy-tls13-ciphers= --proxy-tlsauthtype= --proxy-tlspassword=
  --proxy-tlsuser= --proxy-tlsv1 --proxy-user= --proxy1.0= --proxytunnel --pubkey= --quote= --random-file= --range= --rate= --raw --referer= --remote-header-name
  --remote-name --remote-name-all --remote-time --remove-on-error --request= --request-target= --resolve= --retry= --retry-all-errors --retry-connrefused --retry-delay=
  --retry-max-time= --sasl-authzid= --sasl-ir --service-name= --show-error --show-headers --silent --skip-existing --socks4= --socks4a= --socks5= --socks5-basic
  --socks5-gssapi --socks5-gssapi-nec --socks5-gssapi-service= --socks5-hostname= --speed-limit= --speed-time= --ssl --ssl-allow-beast --ssl-auto-client-cert --ssl-no-revoke
  --ssl-reqd --ssl-revoke-best-effort --ssl-sessions= --sslv2 --sslv3 --stderr= --styled-output --suppress-connect-headers --tcp-fastopen --tcp-nodelay --telnet-option=
  --tftp-blksize= --tftp-no-options --time-cond= --tls-max= --tls13-ciphers= --tlsauthtype= --tlspassword= --tlsuser= --tlsv1 --tlsv1.0 --tlsv1.1 --tlsv1.2 --tlsv1.3
  --tr-encoding --trace= --trace-ascii= --trace-config= --trace-ids --trace-time --unix-socket= --upload-file= --upload-flags= --url= --url-query= --use-ascii --user=
  --user-agent= --variable= --verbose --version --vlan-priority= --write-out= --xattr`;
// wget 1.21: every option of the manual; -nv/-nc/-nd/-nH/-np are two-letter words, not bundles.
const WGET = `-V -h -b -e= -o= -a= -d -q -v -i= -F -B= -t= -O= -c -N -S -T= -w= -Q= -x -P= -k -K -E -p -H -L -D= -I= -X= -r -l= -A= -R= -m -U= -4 -6 -nv -nc -nd -nH -np
  --background --execute= --output-file= --append-output= --debug --quiet --verbose --no-verbose --report-speed= --input-file= --input-metalink= --force-html --base=
  --config= --no-config --rejected-log= --bind-address= --bind-dns-address= --dns-servers= --tries= --output-document= --no-clobber --no-netrc --netrc --continue
  --start-pos= --progress= --show-progress --timestamping --no-if-modified-since --no-use-server-timestamps --server-response --spider --timeout= --dns-timeout=
  --connect-timeout= --read-timeout= --wait= --waitretry= --random-wait --no-proxy --quota= --limit-rate= --user= --password= --ask-password --use-askpass= --no-iri
  --local-encoding= --remote-encoding= --unlink --no-directories --force-directories --no-host-directories --protocol-directories --cut-dirs= --directory-prefix=
  --default-page= --adjust-extension --http-user= --http-password= --no-cache --no-cookies --load-cookies= --save-cookies= --keep-session-cookies --ignore-length --header=
  --compression= --max-redirect= --proxy-user= --proxy-password= --referer= --save-headers --user-agent= --no-http-keep-alive --post-data= --post-file= --method=
  --body-data= --body-file= --content-disposition --content-on-error --auth-no-challenge --secure-protocol= --https-only --no-check-certificate --certificate=
  --certificate-type= --private-key= --private-key-type= --ca-certificate= --ca-directory= --crl-file= --pinnedpubkey= --random-file= --egd-file= --ciphers= --no-hsts
  --hsts-file= --ftp-user= --ftp-password= --no-remove-listing --no-glob --no-passive-ftp --preserve-permissions --retr-symlinks --ftps-implicit --no-ftps-resume-ssl
  --ftps-clear-data-connection --ftps-fallback-to-ftp --warc-file= --warc-header= --warc-max-size= --warc-cdx --warc-dedup= --no-warc-compression --no-warc-digests
  --no-warc-keep-log --warc-tempdir= --recursive --level= --delete-after --convert-links --convert-file-only --backup-converted --mirror --page-requisites --strict-comments
  --accept= --reject= --accept-regex= --reject-regex= --regex-type= --domains= --exclude-domains= --follow-ftp --follow-tags= --ignore-tags= --ignore-case --span-hosts
  --relative --include-directories= --exclude-directories= --no-parent --retry-connrefused --retry-on-host-error --retry-on-http-error= --prefer-family= --inet4-only
  --inet6-only --help --version --no-dns-cache --restrict-file-names= --trust-server-names --xattr --metalink-over-http --metalink-index= --preferred-location= --keep-badhash`;
// rsync 3.3: every option of the manual; `--no-OPTION` is accepted for every switch.
const RSYNC = `-v -q -c -a -r -R -u -d -l -L -k -K -H -p -E -A -X -o -g -D -t -O -J -S -n -W -x -B= -e= -z -C -f= -F -0 -s -4 -6 -h -i -P -y -m -I -b -M= -T= -8 -V -U -N
  --verbose --info= --debug= --stderr= --msgs2stderr --quiet --no-motd --checksum --archive --recursive --relative --no-implied-dirs --backup --backup-dir= --suffix=
  --update --inplace --append --append-verify --dirs --old-dirs --old-d --mkpath --links --copy-links --copy-unsafe-links --safe-links --munge-links --copy-dirlinks
  --keep-dirlinks --hard-links --perms --executability --chmod= --acls --xattrs --owner --group --devices --copy-devices --write-devices --specials --times --atimes
  --open-noatime --crtimes --omit-dir-times --omit-link-times --super --fake-super --sparse --preallocate --dry-run --whole-file --checksum-choice= --one-file-system
  --block-size= --rsh= --rsync-path= --existing --ignore-existing --remove-source-files --del --delete --delete-before --delete-during --delete-delay --delete-after
  --delete-excluded --ignore-missing-args --delete-missing-args --ignore-errors --force --max-delete= --max-size= --min-size= --max-alloc= --partial --partial-dir=
  --delay-updates --prune-empty-dirs --numeric-ids --usermap= --groupmap= --chown= --timeout= --contimeout= --ignore-times --size-only --modify-window= --temp-dir=
  --fuzzy --compare-dest= --copy-dest= --link-dest= --compress --compress-choice= --compress-level= --skip-compress= --cvs-exclude --filter= --exclude= --exclude-from=
  --include= --include-from= --files-from= --from0 --old-args --secluded-args --protect-args --trust-sender --copy-as= --address= --port= --sockopts= --blocking-io
  --outbuf= --stats --8-bit-output --human-readable --progress --itemize-changes --remote-option= --out-format= --log-file= --log-file-format= --password-file=
  --early-input= --list-only --bwlimit= --stop-after= --stop-at= --fsync --write-batch= --only-write-batch= --read-batch= --protocol= --iconv= --checksum-seed= --ipv4
  --ipv6 --version --help --daemon --config= --dparam= --no-detach --server --sender`;
// robocopy (Windows 11): switches with a glued `:value` are listed with the colon; /XD and /XF take every word up to the next switch.
const ROBOCOPY = `/s /e /lev: /z /b /zb /j /efsraw /copy: /dcopy: /sec /copyall /nocopy /secfix /timfix /purge /mir /mov /move /a+: /a-: /create /fat /256 /mon: /mot:
  /rh: /pf /ipg: /sl /mt /mt: /nodcopy /nooffload /compress /sparse /iomaxsize: /iorate: /threshold: /a /m /ia: /xa: /xf+ /xd+ /xc /xn /xo /xx /xl /im /is /it /max: /min:
  /maxage: /minage: /maxlad: /minlad: /fft /dst /xj /xjd /xjf /r: /w: /reg /tbd /lfsm /lfsm: /l /x /v /ts /fp /bytes /ns /nc /ndl /nfl /np /eta /log: /log+: /unilog:
  /unilog+: /tee /njh /njs /unicode /job: /save: /quit /nosd /nodd /if /?`;

const SED = T(`-n --quiet --silent --debug -e= --expression= -f= --file= --follow-symlinks -i? --in-place? -l= --line-length= --posix -E -r --regexp-extended -s --separate
  --sandbox -u --unbuffered -z --null-data -b --binary ${COREUTILS_COMMON}`);

/** The option table of every bash / cmd write-class command the parser reads (autonomy-parse.ts picks the targets by command). */
export const BASH_TABLES: Readonly<Record<string, OptTable>> = {
  rm: T(`-f --force -i -I --interactive? --one-file-system --no-preserve-root --preserve-root? -r -R --recursive -d --dir -v --verbose ${COREUTILS_COMMON}`),
  rmdir: T(`--ignore-fail-on-non-empty -p --parents -v --verbose ${COREUTILS_COMMON} /s /q /?`),
  unlink: T(COREUTILS_COMMON),
  shred: T(`-f --force -n= --iterations= --random-source= -s= --size= -u --remove? -v --verbose -x --exact -z --zero ${COREUTILS_COMMON}`),
  truncate: T(`-c --no-create -o --io-blocks -r= --reference= -s= --size= ${COREUTILS_COMMON}`),
  mkdir: T(`-m= --mode= -p --parents -v --verbose -Z --context? ${COREUTILS_COMMON}`),
  md: T('/?'),
  touch: T(`-a -c --no-create -d= --date= -f -h --no-dereference -m -r= --reference= -t= --time= ${COREUTILS_COMMON}`),
  tee: T(`-a --append -i --ignore-interrupts -p --output-error? ${COREUTILS_COMMON}`),
  chmod: T(CHMOD_LIKE),
  chown: T(`${CHMOD_LIKE} --dereference -h --no-dereference --from=`),
  chgrp: T(`${CHMOD_LIKE} --dereference -h --no-dereference`),
  ln: T(`--backup? -b -d -F --directory -f --force -i --interactive -L --logical -n --no-dereference -P --physical -r --relative -s --symbolic -S= --suffix= -t= --target-directory=
    -T --no-target-directory -v --verbose ${COREUTILS_COMMON}`),
  cp: T(`-a --archive --attributes-only --backup? -b --copy-contents -d --debug -f --force -i --interactive -H -l --link -L --dereference -n --no-clobber -P --no-dereference
    -p --preserve? --no-preserve= --parents -R -r --recursive --reflink? --remove-destination --sparse= --strip-trailing-slashes -s --symbolic-link -S= --suffix= -t=
    --target-directory= -T --no-target-directory --update? -u -v --verbose -x --one-file-system -Z --context? --keep-directory-symlink ${COREUTILS_COMMON}`),
  mv: T(`--backup? -b --debug --exchange -f --force -i --interactive -n --no-clobber --no-copy -S= --suffix= -t= --target-directory= -T --no-target-directory --update? -u
    -v --verbose -Z --context --strip-trailing-slashes ${COREUTILS_COMMON}`),
  install: T(`--backup? -b -C --compare -c -d --directory -D --debug -g= --group= -m= --mode= -o= --owner= -p --preserve-timestamps -s --strip --strip-program= -S= --suffix=
    -t= --target-directory= -T --no-target-directory -v --verbose --preserve-context -Z --context? ${COREUTILS_COMMON}`),
  sort: T(`-b --ignore-leading-blanks -d --dictionary-order -f --ignore-case -g --general-numeric-sort -i --ignore-nonprinting -M --month-sort -h --human-numeric-sort -n
    --numeric-sort -R --random-sort --random-source= -r --reverse --sort= -V --version-sort --batch-size= -c --check? -C --compress-program= --debug --files0-from= -k= --key=
    -m --merge -o= --output= -s --stable -S= --buffer-size= -t= --field-separator= -T= --temporary-directory= --parallel= -u --unique -z --zero-terminated ${COREUTILS_COMMON}`),
  patch: T(`-b --backup --backup-if-mismatch --no-backup-if-mismatch -B= --prefix= --binary -c --context -d= --directory= -D= --ifdef= --dry-run -e --ed -E --remove-empty-files
    -f --force -F= --fuzz= -g= --get= -i= --input= -l --ignore-whitespace --merge? -n --normal -N --forward -o= --output= -p= --strip= --posix --quoting-style= -r= --reject-file=
    -R --reverse -s --silent --quiet -t --batch -T --set-time -u --unified -v --version -V= --version-control= --verbose -x= --debug= -Y= --basename-prefix= -z= --suffix= -Z
    --set-utc --help --follow-symlinks --read-only=`),
  sed: SED, gsed: SED,
  perl: T('-0# -a -C? -c -d? -D? -e= -E= -f -F? -g -h -i? -I= -l# -m? -M? -n -p -s -S -t -T -u -U -v -V? -w -W -x? -X --help --version'),
  ruby: T(`-0# -a -c -C= -d -e= -E= -F? -h -i? -I= -l -n -p -r= -s -S -T? -v -w -W? -x? -y --copyright --version --help --disable? --enable? --disable-gems --enable-gems
    --encoding= --external-encoding= --internal-encoding= --jit? --yjit? --dump= --verbose --debug --backtrace-limit= --crash-report=`),
  tar: T(`${TAR_SHORT} ${TAR_LONG}`),
  unzip: T('-Z -A -c -f -l -p -t -T -u -v -z -a -b -B -C -D -E -F -i -j -J -K -L -M -n -N -o -O= -P= -q -s -S -U -V -W -X -d= -x+ -I= -$ -: -^ -2'),
  '7z': T(`-ai? -an -ao? -ax? -ba -bb? -bd -bs? -bt -i? -m? -o? -p? -r? -sa? -scc? -scs? -sdel -sfx? -si? -slp -slt -sns? -snh? -snl -sni -snr -so -spd -spe -spf? -spm -ssc?
    -sse -ssp -ssw -stl -stm? -stx? -t? -u? -v? -w? -x? -y`, { prefix: true }),
  dd: T(COREUTILS_COMMON),
  find: T(FIND),
  curl: T(CURL, { noPrefix: true }),
  wget: T(WGET),
  rsync: T(RSYNC, { noPrefix: true }),
  robocopy: T(ROBOCOPY),
  xcopy: T('/a /m /d /d: /p /s /e /v /w /c /i /q /f /l /g /h /r /t /u /k /n /o /x /y /-y /z /b /j /exclude: /compress /?'),
  copy: T('/d /v /n /y /-y /z /l /a /b /?'),
  move: T('/y /-y /?'),
  del: T('/p /f /s /q /a /a: /?'),
  erase: T('/p /f /s /q /a /a: /?'),
  rd: T('/s /q /?'),
  ren: T('/?'),
  rename: T('/?'),
  attrib: T('+r -r +a -a +s -s +h -h +o -o +i -i +x -x +p -p +u -u +b -b /s /d /l /?'),
  mklink: T('/d /h /j /?'),
  icacls: T('/grant+ /grant:r+ /deny+ /remove+ /remove:g+ /remove:d+ /reset /setowner= /findsid= /verify /t /c /l /q /inheritance:? /save= /restore= /setintegritylevel= /?'),
};

/** dd's `key=value` operands (coreutils); `if` is read, `of` written, the rest are numbers and flags. */
export const DD_KEYS = new Set(['if', 'of', 'bs', 'ibs', 'obs', 'cbs', 'count', 'skip', 'seek', 'iseek', 'oseek', 'conv', 'status', 'iflag', 'oflag']);

/** One option read from a segment: its table key and the value word it took (the text after a glued `=`/`:` or the next word). */
export interface OptValue { key: string; w: Word }
/** A segment's words read with its command's table. */
export interface Scan {
  /** The operand words (no option and no option value). */
  ops: Word[];
  /** Every option value, in order. */
  vals: OptValue[];
  /** Every option seen (switches included), by table key. */
  flags: Set<string>;
  /** An option outside the table was seen: nothing in the segment can be exempted. */
  unknown: boolean;
  /** Words an unknown option carried that may name a path (its glued value, or the whole `/word`). */
  stray: Word[];
}

const val = (w: Word, from: number): Word => ({ text: w.text.slice(from), dynamic: w.dynamic, glob: w.glob });
const slashKeys = (t: OptTable): boolean => Object.keys(t.opts).some(k => k.startsWith('/'));

/** Whether a word is an option for this table: `-x`, `--x`, a `/switch` (in cmd, or a bare `/x` for a command with `/` keys), a `+x` the table knows. */
function isOption(w: Word, table: OptTable, slashy: boolean, d: Dialect): boolean {
  const t = w.text;
  if (t.length < 2) return false;
  if (t.startsWith('-')) return true;
  if (t.startsWith('/')) return slashy && (d === 'cmd' || !t.slice(1).includes('/'));
  return t.startsWith('+') && table.opts[t.toLowerCase()] !== undefined;
}

/**
 * Read a segment's arguments with its command's table: operands, option values (glued, next-word or following words by
 * the option's kind), the options seen, and whether any option is outside the table (FC3: then no exemption holds).
 */
export function scan(args: Word[], table: OptTable, d: Dialect): Scan {
  const ops: Word[] = [], vals: OptValue[] = [], stray: Word[] = [], flags = new Set<string>();
  const slashy = slashKeys(table);
  let unknown = false, endOpts = false;
  const takeFollowing = (key: string, from: number): number => {
    let k = from;
    while (k < args.length && !isOption(args[k], table, slashy, d)) { vals.push({ key, w: args[k] }); k++; }
    return k - 1;
  };
  for (let i = 0; i < args.length; i++) {
    const w = args[i], t = w.text;
    if (endOpts || !isOption(w, table, slashy, d)) { ops.push(w); continue; }
    if (t === '--') { endOpts = true; continue; }
    if (table.prefix) {
      // 7z: the longest key that prefixes the word, the rest glued
      const key = Object.keys(table.opts).filter(k => t.startsWith(k)).sort((a, b) => b.length - a.length)[0];
      if (!key) { unknown = true; continue; }
      flags.add(key);
      const kind = table.opts[key], rest = t.slice(key.length);
      if (kind === 'g') vals.push({ key, w: val(w, key.length) });
      else if (rest) unknown = true;
      continue;
    }
    const isSlash = t.startsWith('/') || t.startsWith('+');
    const lookup = slashy ? t.toLowerCase() : t; // cmd-style commands read their switches without case
    // a long option (`--x`, `--x=v`), a `/switch` or `/switch:v`, a `+x`, or a single-dash word the table lists whole (-nv, -name)
    const sep = t.startsWith('--') ? t.indexOf('=') : isSlash ? t.indexOf(':') : -1;
    let key = table.opts[lookup] !== undefined ? lookup : sep > 0 ? lookup.slice(0, sep + (isSlash ? 1 : 0)) : lookup;
    let kind: OptKind | undefined = table.opts[key];
    if (kind === undefined && table.noPrefix && key.startsWith('--no-') && table.opts['--' + key.slice(5)] === 'w') kind = 'w';
    if (kind !== undefined) {
      flags.add(key);
      const glued = table.opts[lookup] !== undefined ? -1 : sep;
      if (kind === 'w') { if (glued >= 0) unknown = true; continue; }
      if (kind === 'm') { if (glued >= 0) vals.push({ key, w: val(w, glued + 1) }); else i = takeFollowing(key, i + 1); continue; }
      if (glued >= 0) { vals.push({ key, w: val(w, glued + 1) }); continue; }
      if (kind === 'v') { if (i + 1 < args.length) vals.push({ key, w: args[++i] }); continue; }
      continue; // `g` / `o` with nothing glued: a bare option
    }
    if (t.startsWith('--') || isSlash) {
      unknown = true;
      if (isSlash && d !== 'cmd') stray.push(w); // a bare `/x` in bash may be a path
      else if (sep > 0) stray.push(val(w, sep + 1));
      continue;
    }
    // a short-option bundle, letter by letter
    const letters = t.slice(1);
    for (let j = 0; j < letters.length; j++) {
      key = '-' + letters[j]; kind = table.opts[key];
      if (kind === undefined) { unknown = true; break; }
      flags.add(key);
      if (kind === 'w') continue;
      const rest = letters.slice(j + 1);
      if (kind === 'o') { let m = j + 1; while (m < letters.length && /[0-7]/.test(letters[m])) m++; if (m > j + 1) vals.push({ key, w: { text: letters.slice(j + 1, m), dynamic: w.dynamic, glob: false } }); j = m - 1; continue; }
      if (kind === 'g') { if (rest) vals.push({ key, w: val(w, j + 2) }); break; }
      if (kind === 'm') { if (rest) vals.push({ key, w: val(w, j + 2) }); else i = takeFollowing(key, i + 1); break; }
      if (rest) vals.push({ key, w: val(w, j + 2) }); else if (i + 1 < args.length) vals.push({ key, w: args[++i] });
      break;
    }
  }
  return { ops, vals, flags, unknown, stray };
}

/**
 * Task 6: the options before a command's first operand, read with its table: the operand's index, the scan of the words
 * before it, and whether an option outside the table came first. A word only the shell knows may be options too
 * (`docker $FLAGS rm`): it counts as an unknown one.
 */
export function head(args: Word[], table: OptTable, d: Dialect): { at: number; unknown: boolean; sc: Scan } {
  let unknown = false, at = args.length;
  for (let i = 0; i < args.length; i++) {
    const t = args[i].text;
    if (args[i].dynamic) { unknown = true; continue; }
    if (t === '--') { at = i + 1; break; }
    if (t.length < 2 || !t.startsWith('-')) { at = i; break; }
    const sc = scan(args.slice(i, i + 2), table, d);
    if (sc.unknown) unknown = true;
    if (sc.vals.some(v => v.w === args[i + 1])) i++;
  }
  const sc = scan(args.slice(0, at), table, d);
  return { at, unknown: unknown || sc.unknown, sc };
}

// ---- containers (Task 6): docker, podman and nerdctl, and compose -----------------------------------------------------

export const CONTAINER_CLIS: ReadonlySet<string> = new Set(['docker', 'podman', 'nerdctl']);
export const COMPOSE_CLIS: ReadonlySet<string> = new Set(['docker-compose', 'podman-compose']);
// The global options of docker, podman and nerdctl together (none of them reads one of these keys differently).
export const DOCKER_GLOBAL = T(`--config= -c= --context= -D --debug -H= --host= -l= --log-level= --tls --tlscacert= --tlscert= --tlskey= --tlsverify -v
  --version -h --help -r --remote --connection= --url= --identity= --root= --runroot= --storage-driver= --storage-opt= --cgroup-manager= --events-backend=
  --hooks-dir= --runtime= --tmpdir= --syslog --module= --ssh= --out= --noout --transient-store --imagestore= -a= --address= -n= --namespace= --snapshotter=
  --cni-path= --cni-netconfpath= --data-root= --insecure-registry --hosts-dir= --experimental --host-gateway-ip= --debug-full`);
// docker run / create (docker 27), with podman's and nerdctl's own options.
export const DOCKER_RUN = T(`-a= --attach= --add-host= --annotation= --blkio-weight= --blkio-weight-device= --cap-add= --cap-drop= --cgroup-parent= --cgroupns=
  --cidfile= --cpu-count= --cpu-percent= --cpu-period= --cpu-quota= --cpu-rt-period= --cpu-rt-runtime= -c= --cpu-shares= --cpus= --cpuset-cpus= --cpuset-mems=
  -d --detach --detach-keys= --device= --device-cgroup-rule= --device-read-bps= --device-read-iops= --device-write-bps= --device-write-iops=
  --disable-content-trust --dns= --dns-option= --dns-search= --domainname= --entrypoint= -e= --env= --env-file= --expose= --gpus= --group-add= --health-cmd=
  --health-interval= --health-retries= --health-start-interval= --health-start-period= --health-timeout= --help -h= --hostname= --init -i --interactive
  --io-maxbandwidth= --io-maxiops= --ip= --ip6= --ipc= --isolation= --kernel-memory= -l= --label= --label-file= --link= --link-local-ip= --log-driver= --log-opt=
  --mac-address= -m= --memory= --memory-reservation= --memory-swap= --memory-swappiness= --mount= --name= --network= --net= --network-alias= --net-alias=
  --no-healthcheck --oom-kill-disable --oom-score-adj= --pid= --pids-limit= --platform= --privileged -p= --publish= -P --publish-all --pull= -q --quiet
  --read-only --restart= --rm --runtime= --security-opt= --shm-size= --sig-proxy --stop-signal= --stop-timeout= --storage-opt= --sysctl= --tmpfs= -t --tty
  --ulimit= -u= --user= --userns= --uts= -v= --volume= --volume-driver= --volumes-from= -w= --workdir= --pod= --pod-id-file= --replace --systemd= --secret=
  --arch= --os= --variant= --rootfs --http-proxy= --timezone= --umask= --uidmap= --gidmap= --subuidname= --subgidname= --hostuser= --passwd --passwd-entry=
  --group-entry= --env-host --env-merge= --image-volume= --init-path= --personality= --preserve-fds= --requires= --retry= --retry-delay= --sdnotify=
  --seccomp-policy= --tls-verify= --unsetenv= --unsetenv-all --cgroups= --cgroup-conf= --creds= --cert-dir= --authfile= --no-hosts --decryption-key=`);
export const DOCKER_EXEC = T(`-d --detach --detach-keys= -e= --env= --env-file= -i --interactive --privileged -t --tty -u= --user= -w= --workdir= --help -l
  --latest --preserve-fds= --preserve-fd=`);
export const COMPOSE_GLOBAL = T(`-f= --file= -p= --project-name= --project-directory= --env-file= --profile= --parallel= --ansi= --progress= --compatibility
  --dry-run --all-resources --verbose --no-ansi -v --version -h --help`);
export const COMPOSE_RUN = T(`-d --detach --name= --entrypoint= -e= --env= -l= --label= -u= --user= --no-deps --rm -p= --publish= --service-ports --use-aliases
  -v= --volume= -w= --workdir= -T --no-TTY -i --interactive -t --tty --build --pull= --quiet-pull --remove-orphans --cap-add= --cap-drop= --help`);
export const COMPOSE_EXEC = T('-d --detach --privileged -u= --user= -T --no-TTY --index= -e= --env= -w= --workdir= --help -i --interactive -t --tty');
export const DOCKER_CP = T('-a --archive -L --follow-link -q --quiet --overwrite --help');

// ---- the ssh family (6b-2 Task 0, T6B2-SSH-FAILCLOSED and T6B2-SSH-ONE-PARSER) ----------------------------------------

// Each tool's options from its OpenSSH man page. The network rule judges them (switch, checked value, or unknown target);
// shell-words and every rule find the destination with the same reading (sshParts, head), never a second parser.
export const SSH_OPTS = T('-4 -6 -A -a -C -f -G -g -K -k -N -n -q -T -t -V -v -X -x -Y -y -s -B= -b= -c= -D= -E= -e= -F= -I= -i= -J= -L= -l= -m= -O= -o= -p= -Q= -R= -S= -W= -w=');
export const SCP_OPTS = T('-3 -4 -6 -A -B -C -O -p -q -r -T -v -d -c= -F= -i= -J= -l= -o= -P= -S= -X=');
export const SFTP_OPTS = T('-4 -6 -a -f -N -p -q -r -v -A -C -c= -B= -b= -D= -F= -i= -J= -l= -o= -P= -R= -S= -X=');

/** One ssh call read: the options before the destination, the destination's index (-1 when none), the options OpenSSH reads again right after it, and where the remote command starts. */
export interface SshParts { pre: { at: number; unknown: boolean; sc: Scan }; dest: number; post: { at: number; unknown: boolean; sc: Scan } | null; cmd: number }
/** ssh's words read with SSH_OPTS: OpenSSH re-runs getopt right after the destination, so options there are read too, up to the first non-option (the remote command). */
export function sshParts(args: Word[], d: Dialect): SshParts {
  const pre = head(args, SSH_OPTS, d);
  if (pre.at >= args.length) return { pre, dest: -1, post: null, cmd: args.length };
  const post = head(args.slice(pre.at + 1), SSH_OPTS, d);
  return { pre, dest: pre.at, post, cmd: pre.at + 1 + post.at };
}
