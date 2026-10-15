# BotNexus

Plataforma brasileira de hospedagem de bots do Discord, com painel escuro (preto, roxo neon e azul), feito para funcionar bem no celular Android e no computador.

Esta e uma versao NOVA e completa. Ela nao altera nem corrige arquivos de versoes antigas: use esta pasta separada (veja "Integrar com o projeto antigo").

## O que ja funciona

- Cadastro e login (senhas com hash scrypt, sessao em cookie HttpOnly, bloqueio apos senhas erradas).
- Dashboard com lista de bots, status, tempo ligado, memoria e CPU.
- Upload de projeto em ZIP com validacao rigorosa e instalacao automatica das dependencias (npm).
- Iniciar, parar e reiniciar bots; reinicio automatico opcional.
- Console com logs em tempo real (Server-Sent Events).
- Configuracoes por bot: nome, arquivo principal, token (criptografado), variaveis de ambiente.
- Planos e limites (bots, bots ligados, memoria, disco, tamanho do ZIP).

## Requisitos

- Node.js 22.13 ou mais novo (usa o SQLite embutido, sem compilar nada).
- Unica dependencia de pacote: express.

No Termux (Android):

    pkg update
    pkg install nodejs

Confira com: node -v (precisa mostrar v22.13 ou maior).

## Estrutura de pastas

    BotNexus/
      package.json
      server.js                  inicia o servidor
      variables.env              configuracoes (edite este)
      .env.example               modelo das configuracoes
      .gitignore
      README.md
      scripts/
        check-project.js         verifica sintaxe, imports e dependencias
      src/
        config/index.js          le configuracoes e prepara pastas
        database/db.js           SQLite, tabelas e consultas
        auth/
          passwords.js           hash de senha (scrypt)
          sessions.js            sessoes e cookies
          secretBox.js           criptografia de tokens (AES-256-GCM)
        middleware/
          security.js            cabecalhos, CSRF, limites de requisicao
          auth.js                exige login
          errorHandler.js        mensagens de erro claras
        routes/
          auth.js                cadastro, login, logout
          bots.js                bots, upload, iniciar/parar, logs
          system.js              saude e plano
        services/
          botManager.js          ciclo de vida dos bots, logs, limites
          projectStore.js        valida e instala o ZIP do bot
          zipReader.js           leitor seguro de ZIP (sem dependencias)
          dependencyInstaller.js npm install com comando fixo
          processStats.js        memoria e CPU do bot
          plans.js               planos e limites
          runners/
            processRunner.js     executa o bot como processo restrito
            dockerRunner.js      executa o bot em container Docker
        utils/                   erros, validadores, filtro de segredos, logger
      public/
        index.html
        css/style.css
        js/ui.js api.js views.js botdetail.js app.js
      tests/                     testes automaticos e teste de fumaca

## Passo a passo (celular Android)

1. Extraia o ZIP com o ZArchiver usando "Extrair para ./BotNexus/".
2. Abra o Termux e entre na pasta onde extraiu. Exemplo se estiver em Download:

       termux-setup-storage
       cp -r ~/storage/downloads/BotNexus ~/BotNexus
       cd ~/BotNexus

   Dica: rode o projeto dentro da pasta do Termux (~), nao em /sdcard, porque o armazenamento compartilhado nao aceita algumas operacoes de arquivo.
3. Instale a dependencia:

       npm install

4. (Opcional) Abra variables.env no Acode e ajuste a porta ou outras opcoes. Nao ha nenhum token para preencher aqui: o token de cada bot e colocado depois, pelo painel.
5. Verifique o projeto:

       npm run check
       npm test

6. Inicie:

       npm start

7. Abra no navegador do celular: http://localhost:3000

Para parar o servidor: Ctrl+C no Termux (ele para os bots antes de sair).

## Primeiro uso

1. Crie sua conta.
2. Em Meus bots, toque em Novo bot.
3. Aba Deploy: envie o ZIP do seu bot. Se tiver package.json com dependencias, o BotNexus instala sozinho (acompanhe no Console).
4. Aba Configuracoes: cole o token do bot e salve.
5. Toque em Iniciar e veja o Console.

### Como preparar o ZIP do bot

- Coloque index.js e package.json na raiz do ZIP (ou dentro de uma unica pasta).
- Leia o token em process.env.DISCORD_TOKEN (tambem existe process.env.TOKEN). Nao escreva o token no codigo.
- Coloque suas bibliotecas (discord.js etc.) em dependencies no package.json, usando versoes do npm (ex: ^14.16.0). Dependencias vindas de git, arquivo ou URL sao recusadas.
- Dados que precisam sobreviver a novos envios devem ficar na pasta storage/.
- Nao inclua arquivos .exe, .bat, .cmd, .msi, .scr, .com, .apk, links simbolicos nem ZIP com senha.

## Configuracoes (variables.env)

O BotNexus le ".env" e, se ele nao existir, "variables.env". Isso existe porque alguns compactadores de celular escondem ou removem arquivos que comecam com ponto.

- PORT, HOST: onde o painel escuta.
- BOTNEXUS_SECRET: chave para criptografar tokens (minimo 32 caracteres). Se ficar vazia, o BotNexus gera uma e guarda em data/secret.key. FACA BACKUP desse arquivo: sem ele os tokens salvos nao podem ser lidos.
- COOKIE_SECURE: coloque true quando usar HTTPS.
- TRUST_PROXY: coloque true atras de proxy reverso (para o limite por IP funcionar certo).
- ALLOW_REGISTRATION: false fecha novos cadastros.
- UPLOAD_MAX_MB, EXTRACT_MAX_MB, EXTRACT_MAX_FILES: limites do ZIP.
- GLOBAL_MAX_RUNNING: maximo de bots ligados no servidor todo.
- BOT_RUNNER: process (padrao) ou docker.
- BOT_FS_SANDBOX: auto (padrao), on ou off.

## Seguranca: o que existe e o que NAO existe

Implementado:

- Tokens dos bots ficam criptografados no banco, nunca sao devolvidos pela API e sao ocultados dos logs.
- Nenhum comando do usuario e executado. O servidor roda apenas "node arquivo.js" e "npm install" com argumentos fixos; o arquivo principal e validado.
- Cada consulta filtra pelo dono: um usuario recebe 404 ao tentar acessar bot de outro.
- Upload: limite de tamanho, bloqueio de caminhos com "..", caminhos absolutos, links simbolicos, executaveis, ZIP bomba, ZIP corrompido e dependencias que nao sejam do registro npm. Nada e gravado antes de tudo ser validado.
- Protecao contra abuso: limite de requisicoes por IP e por usuario, limite de envios por hora, bloqueio de login, limite de linhas de log por segundo, limite de memoria e de disco por plano.
- Cabecalhos de seguranca (CSP, anti-clickjacking etc.) e protecao contra CSRF.
- Todas as verificacoes sao feitas no servidor.

Isolamento dos bots (leia com atencao):

- Modo process (padrao): o bot roda como processo separado, com ambiente reduzido (sem nenhum segredo do servidor) e, quando o Node suporta, com o modelo de permissoes: so le e grava na propria pasta e nao consegue abrir outros processos. Isto NAO e um container: o bot continua com o mesmo usuario do sistema e com acesso a rede, e o limite de CPU e apenas monitorado, nao imposto.
- Modo docker (BOT_RUNNER=docker): cada bot roda em container com limite de memoria, CPU e processos, sistema de arquivos somente leitura e sem privilegios. Exige Docker, que nao funciona no Termux. Use em um servidor Linux (VPS) quando for aceitar usuarios que voce nao conhece.
- Recomendacao: para publico externo, use VPS + Docker + HTTPS (proxy reverso) e COOKIE_SECURE=true.

## Planos e limites futuros

Os limites ficam em src/services/plans.js. Para criar um plano novo, adicione uma entrada la e grave o nome do plano na coluna users.plan. Nenhum outro arquivo precisa mudar. Hoje existe apenas o plano gratuito (2 bots, 1 ligado, 256 MB, 100 MB de disco, ZIP de 10 MB).

## Integrar com o projeto antigo

Nao copie arquivos desta versao por cima do projeto antigo, e nao reutilize o banco antigo: as tabelas e o formato de senha sao diferentes (colunas em ingles, hash scrypt). Faca assim:

1. Mantenha o projeto antigo numa pasta separada.
2. Rode o BotNexus novo em outra pasta e valide tudo.
3. Se quiser aproveitar algo do antigo (textos, logo), copie so os arquivos de visual para public/.
4. Usuarios precisam se cadastrar de novo. Se voce precisar migrar contas, e preciso um script especifico (envie o esquema antigo).

## Testes

- npm run check: sintaxe, imports que apontam para arquivos existentes, pacotes declarados, referencias do painel.
- npm test: 35 testes automaticos (validacao, senha, criptografia, sessoes, SQL, ZIP malicioso, execucao real de bots, logs sem token, limites, CSRF, limite de requisicoes).
- npm run smoke: sobe o servidor de verdade e testa a API de ponta a ponta (cadastro, login, isolamento entre usuarios, upload, iniciar, parar, logs). Precisa de npm install antes.

## Problemas comuns

- "precisa do Node.js 22.13": atualize com pkg upgrade nodejs.
- Bot some com ERR_ACCESS_DENIED: o sandbox de arquivos bloqueou algo que o bot precisa. Teste com BOT_FS_SANDBOX=off.
- npm install do bot falha: veja o Console do bot; confirme que o npm funciona no servidor e que as versoes existem.
- Painel nao abre: confira se o servidor esta rodando e se a porta e a mesma do variables.env.

## Limitacoes conhecidas

- Logs ficam em memoria (ultimas 500 linhas por bot) e somem quando o servidor reinicia.
- Limites de requisicao e bloqueio de login ficam em memoria (uma instancia so).
- Ao reiniciar o servidor, os bots NAO voltam sozinhos: inicie-os de novo pelo painel.
- O console usa Server-Sent Events em vez de Socket.IO (mais simples e sem dependencia extra).
- O modo docker foi escrito mas nao foi testado em Docker real.
