const c = (code) => (s) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : String(s));
export const color = { green: c(32), red: c(31), yellow: c(33), cyan: c(36), gray: c(90), bold: c(1) };

export const log = {
  info: (...a) => console.log(color.cyan('ℹ'), ...a),
  ok: (...a) => console.log(color.green('✔'), ...a),
  warn: (...a) => console.log(color.yellow('⚠'), ...a),
  error: (...a) => console.error(color.red('✖'), ...a),
  step: (...a) => console.log(color.gray('→'), ...a),
};
