# Wanted List — Diário de Tesouros

Aplicativo web instalável (PWA) para organizar desejos e coleções com tema One Piece.

## Acesso
- Produção: https://wanted-list.pages.dev
- Hospedagem: Cloudflare Pages, publicação automática a partir da branch `main`.
- Dados: Supabase por meio da Edge Function `wanted-list-secure`.

## Desenvolvimento e publicação
Este é um site estático. O Cloudflare Pages usa:
- Framework preset: None
- Build command: vazio
- Build output directory: `.`
- Branch de produção: `main`

Cada commit na branch `main` dispara uma nova publicação. O service worker mantém cache apenas dos arquivos estáticos do aplicativo; chamadas de API e gravações não são interceptadas.

## Segurança e dados
- O navegador usa apenas a chave publicável do Supabase, nunca a chave `service_role`.
- Leitura e gravação passam pela Edge Function `wanted-list-secure`.
- As tabelas de estado e tentativas de PIN usam RLS sem políticas públicas.
- O PIN dos baús é compartilhado pela função e não representa autenticação individual. Qualquer pessoa que conheça o PIN pode desbloquear os baús privados.
- Não adicione segredos, tokens ou credenciais administrativas a este repositório.

## Funcionalidades
- Baús públicos e privados, catálogo de produtos e status Desejado/Comprado/Desistido.
- Histórico de preços, avaliações, resumo e backup JSON.
- Ícones personalizados e instalação PWA em dispositivos compatíveis.
- Sincronização em nuvem via Edge Function.

## Observações
- A sincronização requer conexão com a internet.
- O cache offline serve os arquivos do app, não permite garantir gravações offline.
- Faça exportações periódicas de backup em Configurações.
- Importação de produtos por link tenta extrair título, imagem e preço dos metadados públicos do anúncio; lojas podem bloquear a consulta ou omitir informações, que continuam editáveis manualmente.
