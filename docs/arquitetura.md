# Boneco Game

Novo projeto focado no modelo de jogo interativo para TikTok.

## Decisões

- O projeto antigo fica como referência e backup.
- O renderer novo não deve importar o renderer gigante antigo.
- DJ, Oráculo e convidados serão pontos/cenas do mapa, não fluxos misturados.
- Câmera e sincronização labial são módulos centrais.
- Assets antigos só entram quando forem necessários para o novo fluxo.

## Módulos iniciais

- `routes/panel.py`: painel principal.
- `routes/renderer.py`: renderer HTML e estado da cena.
- `routes/map_editor.py`: editor básico de mapa.
- `services/map_service.py`: leitura/gravação de mapa.
- `services/media_library.py`: seleção de mídia do personagem.
- `services/audio_timeline.py`: base da sincronização labial.
- `services/speech_queue.py`: filas de fala pendente/pronta.
- `services/tts_service.py`: geração de áudio e timeline.
- `services/tts_worker.py`: worker isolado para preparar áudio sem travar o painel.
- `services/live_events.py`: entrada separada para comentários, presentes e eventos de sistema.
- `services/tiktok_monitor.py`: monitor TikTok independente, com Socket.IO e Tor obrigatório.

## Fila de Eventos

- Comentário usa política de tempo real: fica salvo apenas o comentário mais recente por usuário.
- Presente usa fila dedicada para não ser derrubado por volume de chat.
- Evento de sistema usa fila própria com prioridade.
- A conversão de evento em fala será feita em um worker separado, sem misturar monitoramento com renderização.

## Monitor TikTok

- O painel controla start/stop do monitor.
- O servidor Node do monitor fica em `external/tiktok-live-monitoring-server`.
- `scripts/start_tiktok_monitor.sh` inicia o Node via Tor e bloqueia rede direta.
- `data-chat` entra em `/api/events/comment` via serviço interno.
- `data-gift` entra em `/api/events/gift` via serviço interno.
- Likes, follows e entradas de usuário ainda não viram fala no núcleo novo.

## Próximos blocos

- Criar worker de decisão que transforma evento em fala.
- Integrar transmissão como módulo separado.
- Criar cenas de DJ/Oráculo ligadas a pontos do mapa.
- Criar editor de movimentos do personagem.
- Evoluir a câmera do mapa para seguir o personagem andando.
