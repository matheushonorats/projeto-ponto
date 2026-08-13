# Projeto Ponto

Sistema de **Registro de Ponto com Geolocalização** — Google Apps Script + Google Sheets.

## Funcionalidades

- ✅ Cadastro de funcionários com e-mail e senha (pelo painel admin)
- ✅ Múltiplos locais de trabalho com GPS + raio configurável
- ✅ Cada funcionário vinculado a um ou mais locais
- ✅ Registro de **Entrada, Pausa, Retorno e Saída** com validação sequencial
- ✅ Verificação de geolocalização em tempo real (só registra se dentro da área)
- ✅ Painel administrativo completo (funcionários, locais, relatórios, configurações)
- ✅ Primeiro acesso: criação do admin direto pela interface (sem editar código)
- ✅ 100% configurável pela interface — planilha é só armazenamento

## Tecnologias

| Camada | Tecnologia |
|--------|------------|
| Backend | Google Apps Script (GAS) |
| Banco de dados | Google Sheets |
| Frontend | HTML + Vanilla CSS + JavaScript (servido pelo GAS) |
| Mapa admin | Leaflet.js + OpenStreetMap (gratuito, sem API key) |
| Deploy | Clasp |

## Setup inicial

### 1. Pré-requisitos
```bash
npm install
```

### 2. Login no Clasp
```bash
npm run login
```

### 3. Criar o Google Sheets e o GAS

1. Acesse [sheets.google.com](https://sheets.google.com) e crie uma planilha chamada **"Projeto Ponto"**
2. Na planilha: **Extensões → Apps Script**
3. No editor do GAS: **Configurações do projeto** → copie o **ID do script**
4. Crie o `.clasp.json` na raiz:
```json
{
  "scriptId": "SEU_SCRIPT_ID_AQUI",
  "rootDir": "src/"
}
```

### 4. Fazer push inicial
```bash
npm run push
```

### 5. Publicar o Web App

No editor do GAS:
- **Implantar → Nova implantação**
- Tipo: **App da Web**
- Executar como: **Eu**
- Acesso: **Qualquer pessoa**
- Clique em **Implantar** e copie a URL

### 6. Primeiro acesso

Abra a URL do Web App no navegador. Na tela de **Primeiro Acesso**, crie o administrador. A partir daí, tudo é feito pela interface.

## Deploy versionado

Após criar a implantação inicial e ter o `CLASP_DEPLOYMENT_ID`:

```bash
npm run deploy
```

Isso incrementa a versão patch em `Version.gs`, faz push e implanta automaticamente.

## Comandos disponíveis

| Comando | Descrição |
|---------|-----------|
| `npm run push` | Envia código para o GAS |
| `npm run pull` | Baixa código do GAS |
| `npm run watch` | Push automático ao salvar |
| `npm run deploy` | Deploy versionado (incrementa patch) |
| `npm run status` | Status do clasp |

## Estrutura do projeto

```
src/
├── Code.gs           # Entry point, helpers, auto-setup
├── Auth.gs           # Login, sessão, senha
├── Registros.gs      # Registro de ponto + GPS
├── Admin.gs          # CRUD admin, relatórios, configurações
├── Version.gs        # Versionamento
├── deploy-versionado.cjs
├── appsscript.json
├── index.html        # SPA shell
├── css.html          # Estilos
└── js.html           # JavaScript cliente
```

## Estrutura do Google Sheets (criada automaticamente)

| Aba | Descrição |
|-----|-----------|
| `Funcionarios` | Cadastro de usuários |
| `Locais` | Locais de trabalho com GPS |
| `FuncionarioLocais` | Vínculo funcionário ↔ locais |
| `Registros` | Histórico de pontos batidos |
| `Config` | Configurações do sistema |
| `Sessoes` | Tokens de autenticação |
