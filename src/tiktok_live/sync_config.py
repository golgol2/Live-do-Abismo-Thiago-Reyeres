"""
Sincronização de Configurações para o Sistema de Live TikTok
"""

# Configurações de sincronização de áudio/vídeo
SYNC_SETTINGS = {
    'silence_detection': {
        'threshold': 0.01,
        'min_duration': 0.3,
        'sample_rate': 22050,
        'frame_length': 2048,
        'hop_length': 512
    },
    
    'video_control': {
        'normal_speed': 1.0,
        'pause_speed': 0.0,
        'transition_time': 0.1,
        'buffer_time': 0.05
    },
    
    'processing': {
        'max_retries': 3,
        'timeout_seconds': 300,
        'batch_size': 10
    },
    
    'debug': {
        'enable_logging': True,
        'log_level': 'INFO',
        'trace_timeline': True
    }
}

# Valores padrão para controle de vídeo
DEFAULT_VIDEO_SETTINGS = {
    'speed': 1.0,
    'is_paused': False,
    'current_time': 0.0,
    'total_duration': 0.0
}

# Estrutura esperada do JSON de timeline
EXPECTED_TIMELINE_SCHEMA = {
    'segments': [
        {
            'start': float,
            'end': float,
            'speed': float,
            'type': str
        }
    ],
    'total_duration': float
}

# Tipos de segmentos válidos
VALID_SEGMENT_TYPES = ['normal', 'pause', 'transition']

# Valores de velocidade válidos
VALID_SPEED_VALUES = [0.0, 0.25, 0.5, 0.75, 1.0, 1.5, 2.0]