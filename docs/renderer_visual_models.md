# Modelos visuais do renderer

O renderer principal deve cuidar apenas da base comum da live:

- personagem e troca de videos;
- audio de fala e musica;
- fila de jobs;
- HUD;
- camera;
- ciclo de vida dos layouts.

Cada layout deve cuidar do proprio cenario, piso, efeitos, objetos extras e elementos DOM especificos. Um layout novo nao deve exigir mudanca direta em `renderer.js`, exceto quando o contrato comum realmente precisar ganhar uma capacidade nova.

## Estrutura

- `src/boneco_game/services/layout_manager.py`: catalogo, selecao aleatoria/manual e sessao do layout ativo.
- `src/boneco_game/routes/layouts/`: rotas backend especificas por layout.
- `src/boneco_game/static/js/layouts/registry.js`: registro e ativacao do layout frontend.
- `src/boneco_game/static/js/layouts/<layout>.js`: logica visual do layout.
- `src/boneco_game/static/css/layouts/<layout>.css`: estilos do layout.
- `src/boneco_game/static/js/layouts/README.md`: guia pratico para criar layouts novos.

## Contrato frontend

O renderer fornece um contexto neutro para o layout ativo:

- `layoutCanvas`, `layoutCtx`: canvas principal do layout.
- `layoutOverlayCanvas`, `layoutOverlayCtx`: canvas auxiliar para piso, sobreposicoes ou efeitos.
- `layoutWidth`, `layoutHeight`: tamanho interno do canvas.
- `clearLayoutOverlay()`: limpa o canvas auxiliar.
- `drawVisualProfile(...)`: desenha foto/avatar circular.
- `visualImageEntry(...)`: cache comum de imagens de usuarios.
- `mediaImageUrl(...)`: normaliza caminhos de imagem.
- `getVisualPeople()`: lista de usuarios recentes.
- `getMusicState()`: energia, grave e cor animada comum.
- `getCameraState()`: estado basico da camera.

O layout registrado deve expor:

- `init(context)`;
- `onState(payload, context)`;
- `update(now, state, context)`;
- `render(now, state, context)`;
- `destroy(context)`.

## Regra de isolamento

HTML fixo do renderer nao deve conter objeto de layout especifico. Se um layout precisar de elementos DOM proprios, ele deve cria-los no `init()` e remove-los no `destroy()`.

CSS de layout deve ficar em `static/css/layouts/` e usar classes especificas do proprio layout para nao vazar estilo para outros modelos.

## Layouts atuais

- `classic`: cenario procedural classico.
- `orbital_cathedral`: cenario orbital com piso, formas, medidores e Super Cubo Social.
- `neon_triangle_tower`: piso triangular neon e piramide/ranking visual por presentes.
