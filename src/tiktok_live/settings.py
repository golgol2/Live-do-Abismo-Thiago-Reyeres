"""
Configurações do Sistema de Live TikTok
"""

# Configurações de Sincronização de Áudio/Vídeo
SILENCE_DETECTION = {
    'threshold': 0.01,           # Nível mínimo de amplitude para silêncio
    'min_duration': 0.3,         # Duração mínima de silêncio em segundos
    'sample_rate': 22050,        # Taxa de amostragem do áudio
    'frame_length': 2048,        # Tamanho do frame para análise
    'hop_length': 512            # Hop length para análise
}

# Configurações de Controle de Vídeo
VIDEO_SYNC = {
    'normal_speed': 1.0,         # Velocidade normal do vídeo
    'pause_speed': 0.0,          # Velocidade de pausa (congelamento)
    'transition_time': 0.1       # Tempo de transição entre velocidades
}

# Configurações Gerais
SYSTEM = {
    'debug_mode': True,          # Modo debug para diagnóstico
    'log_level': 'INFO',         # Nível de log
    'max_retries': 3,            # Máximo de tentativas para operações
    'background_removal_enabled': True  # Habilita remoção de fundo
}

# Caminhos de Arquivos
PATHS = {
    'audio_output': './output/audio/',
    'video_output': './output/video/',
    'timeline_output': './output/timeline/',
    'cache_dir': './cache/'
}

# Configurações de TTS
TTS = {
    'engine': 'tts_engine',      # Motor TTS a ser usado
    'voice': 'default_voice',    # Voz padrão
    'speed': 1.0,                # Velocidade de fala
    'pitch': 1.0                 # Tom da voz
}

# Configurações de Processamento
PROCESSING = {
    'batch_size': 10,            # Tamanho do lote para processamento
    'timeout': 300               # Tempo máximo de espera em segundos
}

# Configurações de Remoção de Fundo
BACKGROUND_REMOVAL = {
    'enabled': True,
    'script_path': '~/bin/remove_background.sh',
    'default_output_suffix': '_no_bg.mp4',
    'supported_formats': ['.mp4', '.avi', '.mov'],
    'quality_presets': {
        'high': {'crf': 18, 'preset': 'slow'},
        'medium': {'crf': 23, 'preset': 'medium'},
        'low': {'crf': 28, 'preset': 'fast'}
    }
}
