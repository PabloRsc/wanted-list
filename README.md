# Wanted List — Protótipo funcional 1.1

## Como executar
1. Extraia todo o conteúdo do ZIP para uma pasta.
2. Abra `index.html` no Chrome, Edge ou Opera.
3. Os dados ficam neste navegador e neste dispositivo.

## Funcionalidades incluídas
- Navegação entre Início, Produtos, Wishlists, Tesouros conquistados, Resumo e Configurações.
- Criar, editar e excluir wishlists.
- Ao excluir uma wishlist, os produtos são preservados e apenas perdem o vínculo com ela.
- Cadastro, edição e exclusão de produtos.
- Associação de um produto a várias wishlists.
- Status Desejado, Comprado e Desistido.
- Registro de preço inicial e histórico de alterações de preço.
- Registro opcional de preço pago e data da compra.
- Avaliação ilustrativa e comentário após marcar como Comprado.
- Busca por nome/loja, filtro por status/lista e ordenação.
- Resumo separado de desejos, compras e desistências.
- Exportação e importação JSON com validação e confirmação.
- Redimensionamento/compressão das imagens enviadas para reduzir consumo de armazenamento.
- Tratamento de falha de armazenamento local.

## Limitações conhecidas
- O armazenamento continua sendo `localStorage`: não sincroniza entre PC e celular.
- Não existe backup automático em nuvem nesta versão.
- O histórico de preços registra os valores informados manualmente; não consulta preços das lojas automaticamente.
- Abrir o arquivo diretamente (`file://`) pode ter limitações específicas de navegador. Para uso mais consistente, execute em servidor local simples.
- O valor é exibido em Berries como convenção temática; não há conversão cambial.

## Próxima etapa
Testar os fluxos no navegador, corrigir eventuais falhas encontradas e só depois planejar banco de dados, sincronização e hospedagem. O visual foi mantido deliberadamente próximo ao primeiro protótipo.
