const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const raiz = path.resolve(__dirname, '..');
const arquivoVersao = path.join(__dirname, 'Version.gs');
const arquivoPackage = path.join(raiz, 'package.json');
const deploymentId = process.env.CLASP_DEPLOYMENT_ID || '';
const clasp = process.platform === 'win32'
  ? path.join(raiz, 'node_modules', '.bin', 'clasp.cmd')
  : path.join(raiz, 'node_modules', '.bin', 'clasp');
const simulacao = process.argv.includes('--dry-run');

function executar(argumentos) {
  const comando = `"${clasp}"`;
  const resultado = spawnSync(comando, argumentos, { cwd: raiz, stdio: 'inherit', shell: true });
  if (resultado.error) throw resultado.error;
  if (resultado.status !== 0) throw new Error(`Falha no clasp ${argumentos[0]}.`);
}

const conteudoOriginal = fs.readFileSync(arquivoVersao, 'utf8');
const encontrado = conteudoOriginal.match(/const APP_VERSION = "(\d+)\.(\d+)\.(\d+)";/);
if (!encontrado) throw new Error('Não foi possível localizar APP_VERSION em Version.gs.');

const proximaVersao = `${encontrado[1]}.${encontrado[2]}.${Number(encontrado[3]) + 1}`;
if (simulacao) {
  console.log(`Próxima publicação: V${proximaVersao}`);
  process.exit(0);
}

const novoConteudo = conteudoOriginal
  .replace(encontrado[0], `const APP_VERSION = "${proximaVersao}";`)
  .replace(/const APP_VERSION_DISPLAY = "[^"]+";/, `const APP_VERSION_DISPLAY = "${proximaVersao}";`);
fs.writeFileSync(arquivoVersao, novoConteudo, 'utf8');

let pacoteOriginal = null;
if (fs.existsSync(arquivoPackage)) {
  pacoteOriginal = fs.readFileSync(arquivoPackage, 'utf8');
  const pacote = JSON.parse(pacoteOriginal);
  pacote.version = proximaVersao;
  fs.writeFileSync(arquivoPackage, `${JSON.stringify(pacote, null, 2)}\n`, 'utf8');
}

try {
  console.log(`Publicando V${proximaVersao}...`);
  executar(['push']);
  if (deploymentId) {
    executar(['deploy', '-i', deploymentId, '-d', `V${proximaVersao}`]);
  } else {
    executar(['deploy', '-d', `V${proximaVersao}`]);
  }
  console.log(`✅ V${proximaVersao} publicada com sucesso.`);
} catch (erro) {
  fs.writeFileSync(arquivoVersao, conteudoOriginal, 'utf8');
  if (pacoteOriginal !== null) fs.writeFileSync(arquivoPackage, pacoteOriginal, 'utf8');
  throw erro;
}
