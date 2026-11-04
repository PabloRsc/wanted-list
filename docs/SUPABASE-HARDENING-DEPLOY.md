# Implantação coordenada — segurança dos baús

Os arquivos SQL desta pasta/repositório são preparação, não uma implantação automática.

## Arquivos

- `supabase-hardening-rpc.sql`: cria RPCs para contabilização serializada de tentativas de PIN e limpeza após autenticação.
- `supabase-state-save-rpc.sql`: cria RPC de salvamento transacional que bloqueia o registro de estado e preserva baús privados em salvamentos públicos.
- `supabase-secure-migration.sql`: revoga acesso direto de anon/authenticated à tabela de estado e configura a tabela de tentativas.

## Dependências obrigatórias na Edge Function

A função `wanted-list-secure` deve ser atualizada antes de executar o fluxo completo:

1. Em `unlock`, chamar `wanted_list_register_pin_attempt(p_ip_key)` antes de validar o PIN. Se retornar `false`, responder com HTTP 429 sem validar.
2. Se o PIN estiver incorreto, responder com erro genérico de autenticação. A tentativa já foi registrada atomicamente.
3. Se o PIN estiver correto, chamar `wanted_list_clear_pin_attempts(p_ip_key)` e só então retornar o estado privado.
4. Em `save`, validar o PIN no servidor quando houver solicitação de escrita privada. Chamar `wanted_list_save_state(payload, true)` somente após autenticação válida; sem PIN, chamar `wanted_list_save_state(payload, false)`.
5. Remover da Edge Function o antigo ciclo de leitura/mesclagem/gravação e as consultas separadas à tabela de tentativas.
6. Não confiar em `x-forwarded-for` enviado diretamente pelo cliente. O identificador de IP deve vir de um cabeçalho garantido pelo gateway Supabase ou de um proxy confiável. Se não houver fonte confiável, não fingir que o rate limit por IP é eficaz.
7. Definir limites de tamanho do corpo HTTP e validação estrutural antes de chamar as RPCs. A RPC de estado rejeita payload acima de 5 MB e exige arrays `lists` e `products`.

## Ordem de publicação

1. Fazer e guardar um backup JSON no app.
2. Conferir que a tabela `wanted_list_state` contém a linha `id = 1` e coluna `payload jsonb`, conforme `supabase-setup.sql`.
3. Executar `supabase-hardening-rpc.sql` e `supabase-state-save-rpc.sql` no SQL Editor.
4. Publicar a Edge Function compatível.
5. Executar `supabase-secure-migration.sql` para retirar o acesso direto de anon/authenticated à tabela. Faça isso somente quando a função segura estiver publicada e testada em ambiente de validação; executar antes pode interromper o app.
6. Testar: load público; PIN incorreto; bloqueio após oito tentativas em quinze minutos; PIN correto; salvamento público sem perda de dados privados; salvamento privado autenticado; duas gravações simultâneas; payload excessivo; acesso direto negado a anon/authenticated.

## Atenção

- Não colocar `SERVICE_ROLE_KEY` nem PIN em arquivos do GitHub, no frontend ou em mensagens.
- O PIN atual de quatro dígitos continua fraco. A RPC reduz corrida no rate limit, mas não aumenta a entropia do PIN.
- O SQL não substitui a Edge Function. Enquanto a função não chamar as RPCs, as novas garantias não estão ativas.
- O código atual da Edge Function não está no repositório. Não publicar uma reimplementação aproximada: ela pode quebrar a preservação dos baús ou o formato de resposta esperado pelo app.
- A RPC `wanted_list_save_state` pressupõe o modelo atual de uma única linha em `wanted_list_state`; revisar se o esquema real divergir.
- O salvamento transacional preserva registros privados atuais, mas não substitui uma revisão de autenticação/autorização nem protege contra comprometimento da service role.
