# Migração do projeto antigo

## Regra principal

O projeto antigo não deve ser limpo até o novo ter:

1. Painel funcionando.
2. Renderer funcionando.
3. TTS real funcionando.
4. Monitor TikTok funcionando.
5. Transmissão funcionando.
6. Mapa 2D com personagem andando.
7. Fila de fala e presentes funcionando.

## O que já foi movido

- Ambiente Python por hardlink para evitar reinstalação pesada.
- Configurações privadas essenciais.
- Avatar `BONECO_MAPA_2D`.
- Mapa padrão.
- Vídeos `Mudo`, `Falando`, `Andando_Direita`, `Andando_Esquerda`.
- Base de painel, renderer e editor de mapa.
- TTS real com worker assíncrono.
- Fila separada entre fala pendente e fala pronta.
- Sincronização labial inicial por timeline de áudio.
- Renderer com trava para não consumir nova fala enquanto outra está tocando.
- Status do worker de TTS exposto em `/api/status`.
- Base de eventos em tempo real:
  - comentários guardam só o último texto por usuário;
  - presentes ficam em fila separada;
  - eventos de sistema ficam em fila própria.
- Monitor TikTok básico independente:
  - start/stop pelo painel;
  - servidor Node copiado para `external/`;
  - Tor obrigatório;
  - chat e presente roteados para a fila nova.

## O que ainda será migrado

- Warmup do TTS.
- Sincronização labial avançada no renderer.
- Worker de decisão para transformar eventos em falas.
- Transmissão HTML/RTMP.
- Transmissão RTMP/HTML capture.
- DJ como ponto do mapa.
- Oráculo como ponto do mapa.
- Editor de movimento com loop/corte.

## O que não entra no novo núcleo

- Fluxos antigos de avatar premium.
- Loot antigo visual.
- Cabaré antigo.
- Holograma antigo.
- Efeitos que geraram restrição.
- Games antigos.
