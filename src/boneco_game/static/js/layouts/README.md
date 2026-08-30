# Layouts do Renderer

Esta pasta guarda os layouts visuais carregados pelo renderer da live.

O objetivo da arquitetura é manter o `renderer.js` como nucleo comum e deixar cada layout com seus proprios arquivos. Assim um layout simples nao carrega codigo pesado de outro layout especial.

## Estrutura

```text
src/boneco_game/
├── services/
│   └── layout_manager.py
├── routes/
│   └── layouts/
│       ├── __init__.py
│       ├── control.py
│       ├── classic.py
│       ├── orbital_cathedral.py
│       └── neon_triangle_tower.py
└── static/
    ├── js/
    │   └── layouts/
    │       ├── README.md
    │       ├── registry.js
    │       ├── classic.js
    │       ├── orbital_cathedral.js
    │       └── neon_triangle_tower.js
    └── css/
        └── layouts/
            ├── classic.css
            ├── orbital_cathedral.css
            └── neon_triangle_tower.css
```

## Responsabilidades

### `renderer.html`

Arquivo base da tela de render.

Ele deve carregar apenas:

- CSS comum do renderer.
- `layouts/registry.js`.
- `renderer.js`.

Ele nao deve listar manualmente todos os layouts.

### `renderer.js`

Motor comum da live.

Responsabilidades:

- Buscar `/api/renderer/state`.
- Controlar audio.
- Controlar fala, idle e reacoes do personagem.
- Controlar camera.
- Controlar video/modelo/avatar principal.
- Preparar o contexto comum para os layouts.
- Carregar dinamicamente o CSS e JS do layout ativo.
- Chamar `init`, `update`, `render`, `onState` e `destroy` pelo registry.

O `renderer.js` nao deve ter regra especifica como:

```js
if (activeLayout === "nome_do_layout") {
  // desenho especifico do layout
}
```

Quando um layout precisa de comportamento proprio, esse comportamento deve ficar no arquivo JS do layout.

### `registry.js`

Registro central dos layouts no navegador.

Cada layout chama:

```js
registry.register({
  id: "meu_layout",
  name: "Meu Layout",
  init(context) {},
  update(now, state, context) {},
  render(now, state, context) {},
  onState(payload, context) {},
  destroy(context) {},
});
```

Funcoes:

- `register`: registra um layout.
- `activate`: ativa um layout e chama `destroy` do layout anterior.
- `update`: chamado a cada frame para animacoes do layout.
- `render`: chamado a cada frame para desenhar fundo/chao/efeitos.
- `onState`: chamado quando chega novo estado da live.
- `destroy`: chamado quando o layout deixa de ser ativo.

### `classic.js`

Layout visual classico.

Deve conter apenas o que pertence ao visual classico.

Ele limpa camadas especiais quando entra, para evitar sobra visual de layouts anteriores.

### `orbital_cathedral.js`

Layout Catedral Orbital.

Contem o que e especifico desse layout:

- Fundo/plasma orbital.
- Piso orbital.
- Perspectiva distante propria.
- Super Cubo Social.
- Animacao do Super Cubo.
- Uso de fotos/avatares de usuarios no cenario.

Esse arquivo pode ser grande porque esse layout e especial. O ponto importante e que esse peso so e carregado quando o layout ativo for `orbital_cathedral`.

### `neon_triangle_tower.js`

Layout Torre Triangular Neon.

Contem o que e especifico desse layout:

- Fundo escuro com medidores de batida e formas geometricas tipo hypercubo/tesseract.
- Piso plano feito de triangulos escuros com pequenos espacos entre eles, ocupando toda a metade inferior da tela.
- Linhas RGB fortes por baixo dos espacos do piso, simulando energia passando com a batida.
- Piramide 3D estatica formada por cubos com fotos dos usuarios, preenchendo de baixo para cima.
- A piramide usa slots fixos: tamanho e posicao dos cubos nao mudam durante a live.
- Ao passar do limite de slots, o layout troca as fotos/conteudos pelo ranking atual em vez de adicionar mais cubos.
- Organizacao dos slots baseada no ranking/quantidade de presentes.
- Brilho da cena com base em `musicBass` e `musicEnergy`, sem mover a estrutura da piramide.

A piramide usa HTML/CSS porque cada face do cubo pode receber uma imagem real de usuario. O fundo, os medidores e o piso ficam no canvas para continuar leve no renderer.

### `static/css/layouts/*.css`

CSS proprio de cada layout.

Exemplos:

- `classic.css`: estilos especificos do classico.
- `orbital_cathedral.css`: estilos do Super Cubo e elementos orbitais.
- `neon_triangle_tower.css`: estilos da torre 3D de cubos e ajustes do palco desse template.

CSS especifico de layout nao deve ficar em `renderer.css`.

### `layout_manager.py`

Catalogo central dos layouts.

Cada layout precisa de uma entrada no `LAYOUT_CATALOG`:

```python
{
    "id": "meu_layout",
    "name": "Meu Layout",
    "description": "Descricao do layout.",
    "enabled_by_default": True,
    "backend_module": "meu_layout",
    "backend_route": "/api/layouts/meu_layout",
    "frontend_module": "/static/js/layouts/meu_layout.js",
    "css": "/static/css/layouts/meu_layout.css",
}
```

Campos:

- `id`: identificador unico do layout.
- `name`: nome exibido no painel.
- `description`: explicacao curta.
- `enabled_by_default`: se entra habilitado por padrao na rotacao.
- `backend_module`: modulo Python opcional em `routes/layouts`.
- `backend_route`: rota publica opcional do layout.
- `frontend_module`: arquivo JS que sera carregado quando o layout estiver ativo.
- `css`: arquivo CSS que sera carregado quando o layout estiver ativo.

### `routes/layouts/`

APIs relacionadas aos layouts.

- `control.py`: API geral para listar e configurar layouts.
- `classic.py`: API especifica do classico, se precisar.
- `orbital_cathedral.py`: API especifica da Catedral Orbital, se precisar.
- `neon_triangle_tower.py`: API especifica da Torre Triangular Neon, hoje usada para metadados.
- `__init__.py`: inclui as rotas declaradas no catalogo.

Um layout novo so precisa de arquivo Python aqui se tiver configuracao ou endpoint proprio.

## Contrato do Layout JS

Todo layout JS deve ser um modulo isolado:

```js
(() => {
  const registry = window.BonecoLayoutRegistry;

  if (!registry) {
    console.error("BonecoLayoutRegistry ausente para meu_layout.");
    return;
  }

  registry.register({
    id: "meu_layout",
    name: "Meu Layout",

    init(context) {
      context.stage.dataset.layout = "meu_layout";
    },

    update(now, state, context) {},

    render(now, state, context) {
      return true;
    },

    onState(payload, context) {},

    destroy(context) {
      context.clearLayoutOverlay?.();
    },
  });
})();
```

## Contexto Disponivel Para Layouts

O `renderer.js` entrega um `context` com recursos comuns.

Principais campos:

- `stage`: elemento principal da cena.
- `cameraLayer`: camada de camera.
- `layoutCanvas`: canvas principal do layout.
- `layoutOverlayCanvas`: canvas de piso/sobreposicao.
- `layoutCtx`: contexto 2D do canvas principal.
- `layoutOverlayCtx`: contexto 2D do piso.
- `skyLayer`: camada de ceu/fundo HTML.
- `world`: camada do mundo/personagem.
- `actorLayer`: camada do personagem.
- `mapBack`: objetos atras do personagem.
- `mapFront`: objetos na frente do personagem.
- `layoutWidth`: largura interna do canvas.
- `layoutHeight`: altura interna do canvas.
- `clearLayoutOverlay`: limpa o canvas de piso.
- `drawVisualProfile`: desenha foto/avatar circular de usuario.
- `mediaImageUrl`: converte caminho de imagem em URL carregavel.
- `visualImageEntry`: acessa imagem pre-carregada de usuario.
- `isLayoutVisualMode`: informa se o renderer esta em modo de layout.
- `getActiveLayout`: retorna o layout ativo.
- `getVisualMode`: retorna `layout` ou `map`.
- `getVisualPeople`: retorna usuarios recentes da live.
- `getMusicState`: retorna energia, grave e hue da musica.
- `getCameraState`: retorna estado comum da camera.

## Como Criar Um Novo Layout

1. Criar `static/js/layouts/meu_layout.js`.
2. Criar `static/css/layouts/meu_layout.css` se houver estilo proprio.
3. Criar `routes/layouts/meu_layout.py` apenas se o layout precisar de endpoint proprio.
4. Registrar o layout em `LAYOUT_CATALOG`, dentro de `services/layout_manager.py`.
5. Manter toda regra visual especial dentro do JS/CSS do layout.
6. Usar somente o `context` comum entregue pelo `renderer.js`.

Regra principal: o `renderer.js` deve continuar limpo. Se uma funcao so existe para um template, ela pertence ao arquivo daquele template.

## Estado Entregue no `render`

O metodo `render(now, state, context)` recebe:

- `now`: timestamp do frame.
- `state.musicEnergy`: energia atual da musica.
- `state.musicBass`: grave atual da musica.
- `state.visualHue`: cor/hue animada comum.
- `state.visualPeople`: usuarios recentes para efeitos visuais.
- `state.visualMode`: modo visual atual.
- `state.activeLayout`: layout ativo.

Se o layout desenhar a cena, deve retornar `true`.

Se retornar `false`, o renderer pode usar fallback comum.

## Estado Entregue no `onState`

O metodo `onState(payload, context)` recebe o JSON de `/api/renderer/state`.

Esse payload pode conter:

- `state`: configuracoes gerais.
- `layout`: estado e catalogo dos layouts.
- `visual_people`: usuarios recentes.
- `gift_leaderboard`: ranking de presentes.
- `top_gifter`: maior presenteador.
- `music`: musicas disponiveis.
- `media`: videos do personagem.
- `map`: mapa atual.

Use `onState` para sincronizar elementos que dependem de eventos da live, como ranking de presentes, fotos de usuarios, objetos sociais e configuracoes vindas do painel.

## Como Criar Um Layout Novo

1. Criar o JS:

```text
src/boneco_game/static/js/layouts/meu_layout.js
```

2. Criar o CSS:

```text
src/boneco_game/static/css/layouts/meu_layout.css
```

3. Se precisar de API propria, criar:

```text
src/boneco_game/routes/layouts/meu_layout.py
```

4. Adicionar entrada no `LAYOUT_CATALOG` em:

```text
src/boneco_game/services/layout_manager.py
```

5. Reiniciar o servidor.

## Regras Para Nao Voltar a Crescer o Renderer

- Nao colocar desenho especifico de layout em `renderer.js`.
- Nao colocar CSS especifico de layout em `renderer.css`.
- Nao adicionar `<script>` ou `<link>` de layout direto no `renderer.html`.
- Nao criar `if activeLayout === ...` no renderer.
- Usar `context` para acessar recursos comuns.
- Usar `onState` para dados da live.
- Usar `update` para animacoes por frame.
- Usar `render` para desenho por frame.
- Usar `destroy` para limpar elementos quando trocar de layout.

## Personalizacao Futura

A arquitetura ja deixa caminho para layouts especiais com:

- Fundo configuravel.
- Chao configuravel.
- Objetos atras do personagem.
- Objetos na frente do personagem.
- Efeitos por presente/comentario.
- Retorno futuro de avatares de usuarios.

Para isso, cada layout pode ganhar uma configuracao propria no backend e ler essa configuracao pelo `onState`.

O personagem/modelo principal deve continuar no renderer comum, para todos os layouts reaproveitarem a mesma base de fala, idle, reacao, camera e audio.
