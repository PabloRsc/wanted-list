# Revisão de segurança — Wanted List

Atualizado em 2026-11-04.

Este documento separa correções já versionadas de ações que dependem do projeto Supabase. Não contém chaves, PINs ou outros segredos.

## Alterações versionadas no GitHub

- O importador de anúncios limita o corpo recebido a 4 KB.
- O limite de 10 segundos cobre a requisição externa e a leitura do corpo HTML.
- O importador rejeita endereços IP literais e nomes de host locais/privados conhecidos.
- A versão do script e do cache do PWA foi atualizada para evitar servir arquivos antigos.

**Limitação importante:** a validação de hostname não elimina, por si só, risco de DNS rebinding. A função ainda faz uma requisição para um host fornecido pelo usuário. Antes de tratar o importador como totalmente protegido contra SSRF, é necessário validar o IP efetivamente resolvido e impedir destinos privados após cada redirecionamento. Uma expressão regular não resolve DNS rebinding.

## Baús privados — riscos identificados

1. PIN de quatro dígitos tem apenas 10.000 combinações. Recomenda-se um segredo aleatório longo, mantido apenas no ambiente Supabase.
2. A limitação atual de tentativas faz consulta e inserção em operações separadas; requisições simultâneas podem ultrapassar o limite. A contagem precisa ser atômica no PostgreSQL.
3. O salvamento faz leitura, mesclagem e gravação em etapas separadas. Duas gravações simultâneas podem sobrescrever alterações. A operação deve ser transacional, com bloqueio da linha/registro.
4. O IP do cliente só pode ser usado para rate limit se vier de cabeçalho definido por proxy confiável. Não confiar em x-forwarded-for arbitrário enviado pelo cliente.
5. Validar tamanho máximo do JSON, quantidade de listas/produtos/histórico e comprimentos dos campos antes de persistir.
6. Verificar RLS e privilégios das tabelas. A service role deve permanecer exclusivamente no ambiente da Edge Function.
7. A resposta pública atualmente preserva metadados dos baús privados. Isso é uma decisão de produto: cartões podem aparecer, mas nomes, descrições, capas e IDs podem ser vistos por qualquer pessoa que consulte o endpoint público.
8. CORS não autentica clientes. O endpoint deve ser tratado como público e protegido no servidor.

## Plano seguro de implantação

Não aplicar uma migração SQL genérica sem conferir o esquema real. Os nomes e tipos das colunas de wanted_list_state e wanted_list_pin_attempts, as políticas RLS e as dependências da Edge Function precisam ser confirmados primeiro.

1. Confirmar o esquema das duas tabelas e as políticas RLS, sem compartilhar credenciais.
2. Criar funções SQL transacionais para registrar/consultar tentativas e salvar o estado com lock.
3. Atualizar a Edge Function para chamar essas RPCs, validar o payload e falhar de forma segura quando o rate limit não puder ser consultado.
4. Atualizar o formato de PIN no frontend e no Supabase em uma janela coordenada, sem expor o novo segredo.
5. Testar acesso público, PIN incorreto, bloqueio por tentativas, desbloqueio correto, gravações simultâneas e preservação dos dados privados.
6. Só então publicar a nova Edge Function e a migração no projeto Supabase.

## Estado

- Código do importador atualizado no GitHub.
- Cache do PWA atualizado.
- Migração `supabase-hardening-rpc.sql` criada para rate limit atômico e limpeza de tentativas expiradas; ainda não aplicada.
- A Edge Function ainda precisa ser atualizada para chamar as RPCs; até isso acontecer, a migração sozinha não altera o comportamento do endpoint.
- Proteções de concorrência no salvamento do estado ainda não implementadas.
- Não foi possível verificar o deploy do Cloudflare Pages nem executar testes contra o projeto Supabase nesta etapa.

## Atualização — 2026-11-04

Foram adicionadas duas migrações complementares:

- `supabase-hardening-rpc.sql`: tentativas de PIN serializadas por advisory lock, limite de oito em quinze minutos e limpeza de tentativas antigas.
- `supabase-state-save-rpc.sql`: gravação transacional do JSON, com lock e preservação de baús privados durante salvamentos públicos.

Também foi criado `docs/SUPABASE-HARDENING-DEPLOY.md` com a ordem de publicação e as chamadas que a Edge Function deverá fazer.

**Não marcar como concluído:** a Edge Function atual não está versionada no repositório e não pode ser substituída com segurança por uma versão reconstruída parcialmente. As migrações ainda não foram executadas no Supabase, a função ainda não foi publicada e não foram realizados testes no ambiente real. A proteção só estará ativa depois da integração e publicação coordenadas.


## Atualização — Edge Function revisada e versionada

Em 2026-11-04 foi adicionada a implementação revisada em `supabase/functions/wanted-list-secure/index.ts`. O frontend foi atualizado para pedir uma senha de 16 a 128 caracteres e autenticar a criação do primeiro baú privado. A RPC de estado também foi ajustada para impedir que um visitante sem senha reivindique o primeiro baú privado.

A função chama as RPCs de rate limit e salvamento transacional, valida o payload e limita o corpo durante a leitura do stream. A ordem de implantação está em `docs/SUPABASE-HARDENING-DEPLOY.md`.

**Ainda não implantado/verificado no Supabase:** as migrações SQL não foram executadas, o secret `PRIVATE_CHEST_PIN` não foi alterado, a Edge Function não foi publicada e os testes de integração não foram executados. Portanto, esta revisão de código não equivale à ativação da proteção em produção.


### Correções adicionais de revisão — 2026-11-04

- Corrigida a validação do PIN no frontend: agora aceita a senha de 16 a 128 caracteres exigida pela Edge Function (antes havia uma validação residual de exatamente quatro dígitos).
- Corrigida a RPC para também exigir autenticação ao criar um baú privado quando a tabela ainda não possui a linha inicial.
- O rate limit deixou de usar `x-forwarded-for`; usa apenas `cf-connecting-ip` e cai em um bucket compartilhado se o cabeçalho estiver ausente. Antes da publicação, confirmar que o gateway Supabase define esse cabeçalho de forma confiável.
- Atualizado o cache do PWA e corrigida a orientação de ordem da migração que revoga acesso direto à tabela.

Essas correções estão versionadas, mas continuam pendentes de execução e validação no projeto Supabase real.
