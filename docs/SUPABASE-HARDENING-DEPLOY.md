# Implantação coordenada — segurança dos baús

Os arquivos deste repositório preparam a correção, mas não alteram automaticamente o projeto Supabase.

## Arquivos

- `supabase-hardening-rpc.sql`: rate limit atômico de tentativas de senha.
- `supabase-state-save-rpc.sql`: salvamento transacional e preservação de baús privados.
- `supabase/functions/wanted-list-secure/index.ts`: Edge Function revisada.
- `supabase-secure-migration.sql`: revoga acesso direto de anon/authenticated à tabela de estado.

## Ordem de publicação

1. Fazer e guardar um backup JSON pelo app.
2. No painel Supabase, atualizar o secret `PRIVATE_CHEST_PIN` para uma senha aleatória com pelo menos 16 caracteres (até 128). Não compartilhar esse valor e não colocá-lo no GitHub.
3. Conferir que `wanted_list_state` contém a linha `id = 1` e a coluna `payload jsonb`, conforme `supabase-setup.sql`.
4. Executar `supabase-hardening-rpc.sql` no SQL Editor.
5. Executar `supabase-state-save-rpc.sql` no SQL Editor.
6. Publicar exatamente `supabase/functions/wanted-list-secure/index.ts` como a Edge Function `wanted-list-secure`.
7. Testar primeiro load, desbloqueio, criação de baú privado e salvamentos com as permissões atuais ainda ativas.
8. Somente se os testes funcionarem, executar `supabase-secure-migration.sql` para revogar o acesso direto de anon/authenticated.
9. Repetir load e salvamento após a migração e confirmar que o acesso direto à tabela é negado.

## O que a Edge Function faz

- Usa RPCs para registrar tentativas de senha de forma serializada e limpar tentativas após autenticação válida.
- Exige senha de pelo menos 16 caracteres no secret `PRIVATE_CHEST_PIN`.
- Exige autenticação também para criar o primeiro baú privado ou converter um baú público em privado.
- Usa RPC transacional para salvar estado, evitando read/merge/write concorrente.
- Limita o corpo HTTP durante a leitura do stream a 5 MB.
- Valida arrays, quantidade de registros, IDs duplicados e comprimentos de campos antes de persistir.
- Responde com `Cache-Control: no-store`.

## Testes necessários

- `load` público sem conteúdo de produtos privados.
- PIN/senha incorreta retorna 401.
- Oito tentativas no intervalo de quinze minutos são limitadas; novas tentativas recebem 429.
- Senha correta libera o estado privado.
- Criar o primeiro baú privado exige senha.
- Salvamento público não apaga nem altera listas, produtos ou histórico privados.
- Salvamento privado autenticado permite editar conteúdo privado.
- Duas gravações simultâneas não perdem dados privados.
- Corpo acima de 5 MB ou estrutura inválida é rejeitado.
- Acesso direto à tabela por anon/authenticated é negado após a migração.

## Limites e cuidados

- Não colocar `SERVICE_ROLE_KEY` nem senha em arquivos do GitHub, frontend ou mensagens.
- O app mantém a senha privada apenas em memória durante a sessão; recarregar a página exigirá desbloquear novamente.
- O endpoint é público. CORS não é autenticação.
- O rate limit usa somente `cf-connecting-ip`; não confia em `x-forwarded-for`. Confirme no ambiente Supabase que o gateway sobrescreve `cf-connecting-ip`. Se o cabeçalho estiver ausente, todos os clientes compartilham o bucket `unknown`, o que é seguro contra falsificação, mas pode limitar o uso legítimo em conjunto.
- Os cartões dos baús privados continuam visíveis publicamente por decisão de produto; nome, descrição, capa e identificador do baú não são secretos.
- A migração SQL pressupõe o esquema atual de uma única linha em `wanted_list_state`. Não executar se o esquema real divergir.
- A proteção não está ativa até executar as migrações, publicar a Edge Function e concluir os testes.
