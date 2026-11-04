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
- Proteções da Edge Function e do banco ainda não implantadas.
- Não foi possível verificar o deploy do Cloudflare Pages nem executar testes contra o projeto Supabase nesta etapa.