"""
Audio Timeline Generator for TikTok Live System
Handles synchronization between audio and video with proper pause detection
"""

import numpy as np
import json
from typing import List, Dict, Tuple
import librosa
import time

class AudioTimelineGenerator:
    def __init__(self):
        # Configurações de detecção de silêncio
        self.silence_threshold = 0.01  # Nível mínimo de amplitude para considerar silêncio
        self.min_silence_duration = 0.3  # Duração mínima de silêncio em segundos
        self.sample_rate = 22050  # Taxa de amostragem padrão
        self.frame_length = 2048  # Tamanho do frame para análise
        self.hop_length = 512     # Hop length para análise
    
    def create_audio_timeline(self, audio_file_path: str) -> Dict:
        """
        Cria timeline com controle de velocidade para sincronização de vídeo
        """
        try:
            print(f"Processando arquivo de áudio: {audio_file_path}")
            
            # Carrega o arquivo de áudio
            audio_data, sr = librosa.load(audio_file_path, sr=self.sample_rate)
            print(f"Duração do áudio: {len(audio_data) / self.sample_rate:.2f}s")
            
            # Detecta períodos de silêncio
            silence_periods = self._detect_silence_periods(audio_data)
            print(f"Períodos de silêncio detectados: {len(silence_periods)}")
            
            # Gera timeline com controle de velocidade
            timeline = self._generate_sync_timeline(audio_data, silence_periods)
            
            # Adiciona informações de debug
            timeline['generated_at'] = time.time()
            timeline['source_file'] = audio_file_path
            timeline['processing_time'] = time.time()
            
            print(f"Timeline gerado com {len(timeline.get('segments', []))} segmentos")
            return timeline
            
        except Exception as e:
            print(f"Erro ao criar timeline: {str(e)}")
            import traceback
            traceback.print_exc()
            return self._create_default_timeline()
    
    def _detect_silence_periods(self, audio_data: np.ndarray) -> List[Dict]:
        """
        Detecta períodos de silêncio no áudio com melhor precisão
        """
        print("Detectando períodos de silêncio...")
        
        # Calcula a amplitude RMS (Root Mean Square) para cada frame
        rms = librosa.feature.rms(y=audio_data, frame_length=self.frame_length, hop_length=self.hop_length)
        
        # Converte para array 1D e normaliza
        rms_db = 20 * np.log10(rms[0] + 1e-10)  # Adiciona pequeno valor para evitar log(0)
        
        # Detecta onde o áudio está abaixo do threshold de silêncio
        silence_mask = rms_db < self._db_to_amplitude(self.silence_threshold)
        
        # Encontra segmentos contíguos de silêncio
        silence_periods = []
        in_silence = False
        start_time = 0
        
        # Calcula o tempo para cada frame
        frame_times = np.arange(len(rms_db)) * (self.hop_length / self.sample_rate)
        
        for i, is_silent in enumerate(silence_mask):
            current_time = frame_times[i]
            
            if is_silent and not in_silence:
                # Início de silêncio
                start_time = current_time
                in_silence = True
                
            elif not is_silent and in_silence:
                # Fim de silêncio
                end_time = current_time
                duration = end_time - start_time
                
                if duration >= self.min_silence_duration:
                    silence_periods.append({
                        'start': float(start_time),
                        'end': float(end_time),
                        'duration': float(duration)
                    })
                    print(f"Silêncio detectado: {start_time:.2f}s - {end_time:.2f}s (duração: {duration:.2f}s)")
                
                in_silence = False
        
        # Trata o caso onde o áudio termina em silêncio
        if in_silence:
            end_time = frame_times[-1]
            duration = end_time - start_time
            
            if duration >= self.min_silence_duration:
                silence_periods.append({
                    'start': float(start_time),
                    'end': float(end_time),
                    'duration': float(duration)
                })
                print(f"Silêncio no final: {start_time:.2f}s - {end_time:.2f}s (duração: {duration:.2f}s)")
        
        return silence_periods
    
    def _db_to_amplitude(self, db_value: float) -> float:
        """
        Converte dB para amplitude
        """
        return 10 ** (db_value / 20)
    
    def _generate_sync_timeline(self, audio_data: np.ndarray, silence_periods: List[Dict]) -> Dict:
        """
        Gera o JSON de sincronização com controle de velocidade
        """
        # Calcula a duração total do áudio
        total_duration = len(audio_data) / self.sample_rate
        
        print(f"Gerando timeline para {total_duration:.2f}s")
        
        # Inicializa a timeline
        segments = []
        
        # Se não há silêncios, retorna apenas um segmento normal
        if not silence_periods:
            segments.append({
                'start': 0.0,
                'end': float(total_duration),
                'speed': 1.0,
                'type': 'normal'
            })
            result = {
                'segments': segments,
                'total_duration': float(total_duration),
                'silence_periods': []
            }
            print("Nenhum silêncio detectado, timeline com segmento único")
            return result
        
        # Ordena silêncios por tempo de início
        silence_periods.sort(key=lambda x: x['start'])
        
        # Adiciona segmento inicial (antes do primeiro silêncio)
        if silence_periods[0]['start'] > 0:
            segments.append({
                'start': 0.0,
                'end': float(silence_periods[0]['start']),
                'speed': 1.0,
                'type': 'normal'
            })
        
        # Processa todos os silêncios
        last_end = 0.0
        
        for i, silence in enumerate(silence_periods):
            # Adiciona segmento normal antes do silêncio (se houver)
            if silence['start'] > last_end:
                segments.append({
                    'start': float(last_end),
                    'end': float(silence['start']),
                    'speed': 1.0,
                    'type': 'normal'
                })
            
            # Adiciona segmento de pausa
            segments.append({
                'start': float(silence['start']),
                'end': float(silence['end']),
                'speed': 0.0,  # Pausa completa
                'type': 'pause',
                'duration': float(silence['duration'])
            })
            
            last_end = silence['end']
        
        # Adiciona segmento final (após o último silêncio)
        if last_end < total_duration:
            segments.append({
                'start': float(last_end),
                'end': float(total_duration),
                'speed': 1.0,
                'type': 'normal'
            })
        
        # Garante que os segmentos sejam contíguos e ordenados
        self._validate_timeline(segments)
        
        result = {
            'segments': segments,
            'total_duration': float(total_duration),
            'silence_periods': silence_periods,
            'timestamp': time.time()
        }
        
        print(f"Timeline gerado com {len(segments)} segmentos")
        return result
    
    def _validate_timeline(self, segments: List[Dict]) -> None:
        """
        Valida que a timeline esteja correta e evita problemas de sincronização
        """
        print("Validando timeline...")
        
        # Verifica se os segmentos são contíguos e ordenados
        for i in range(len(segments) - 1):
            current_end = segments[i]['end']
            next_start = segments[i + 1]['start']
            
            if abs(current_end - next_start) > 0.01:  # Tolerância de 0.01 segundos
                print(f"Warning: Gap detected between segments {i} and {i+1}")
                print(f"  Segmento {i}: end={current_end}")
                print(f"  Segmento {i+1}: start={next_start}")
        
        # Garante que não haja segmentos com velocidade inválida
        for i, segment in enumerate(segments):
            speed = segment.get('speed', 1.0)
            if speed < 0:
                print(f"Warning: Segment {i} has invalid negative speed: {speed}")
                segment['speed'] = 1.0  # Corrige para velocidade normal
            elif speed > 2.0:
                print(f"Warning: Segment {i} has excessive speed: {speed}")
                segment['speed'] = 1.0  # Corrige para velocidade normal
                
        # Garante que o primeiro segmento comece em 0
        if segments and segments[0]['start'] != 0.0:
            print("Warning: First segment should start at 0.0")
            segments[0]['start'] = 0.0
    
    def _create_default_timeline(self) -> Dict:
        """
        Cria timeline padrão em caso de erro
        """
        print("Criando timeline padrão")
        return {
            'segments': [
                {
                    'start': 0.0,
                    'end': 10.0,
                    'speed': 1.0,
                    'type': 'normal'
                }
            ],
            'total_duration': 10.0,
            'silence_periods': [],
            'timestamp': time.time()
        }

# Função de utilidade para salvar timeline
def save_timeline_to_json(timeline_data: Dict, output_file: str) -> bool:
    """
    Salva o timeline em formato JSON com validação
    """
    try:
        # Valida o conteúdo antes de salvar
        if 'segments' not in timeline_data:
            print("Erro: Timeline não contém segmentos")
            return False
            
        # Adiciona timestamp para debug
        timeline_data['saved_at'] = time.time()
        
        with open(output_file, 'w') as f:
            json.dump(timeline_data, f, indent=2, ensure_ascii=False)
        print(f"Timeline salvo em {output_file}")
        return True
    except Exception as e:
        print(f"Erro ao salvar timeline: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

# Função de utilidade para carregar timeline
def load_timeline_from_json(input_file: str) -> Dict:
    """
    Carrega o timeline de um arquivo JSON com validação
    """
    try:
        with open(input_file, 'r') as f:
            data = json.load(f)
        
        # Valida estrutura básica
        if not isinstance(data, dict):
            print("Erro: Dados não são um dicionário")
            return None
            
        if 'segments' not in data:
            print("Erro: Arquivo não contém segmentos")
            return None
            
        print(f"Timeline carregado com sucesso: {len(data['segments'])} segmentos")
        return data
        
    except Exception as e:
        print(f"Erro ao carregar timeline: {str(e)}")
        import traceback
        traceback.print_exc()
        return None

# Função para verificar compatibilidade com render HTML
def validate_for_html_render(timeline_data: Dict) -> bool:
    """
    Valida se o timeline é compatível com o render HTML
    """
    print("Validando compatibilidade com render HTML...")
    
    if not timeline_data:
        print("Timeline vazio")
        return False
    
    segments = timeline_data.get('segments', [])
    
    # Verifica campos obrigatórios para cada segmento
    required_fields = ['start', 'end', 'speed']
    
    for i, segment in enumerate(segments):
        for field in required_fields:
            if field not in segment:
                print(f"Erro: Segmento {i} falta campo '{field}'")
                return False
                
        # Valida tipos de dados
        try:
            float(segment['start'])
            float(segment['end']) 
            float(segment['speed'])
        except (ValueError, TypeError):
            print(f"Erro: Segmento {i} tem tipo inválido em algum campo")
            return False
    
    print("Timeline compatível com render HTML")
    return True

# Função para gerar relatório detalhado de problemas
def generate_sync_report(timeline_data: Dict) -> str:
    """
    Gera um relatório detalhado sobre o timeline para diagnóstico
    """
    if not timeline_data:
        return "Timeline vazio"
    
    report = []
    report.append("=" * 50)
    report.append("RELATÓRIO DE SINCRONIZAÇÃO DETALHADO")
    report.append("=" * 50)
    
    report.append(f"Arquivo de origem: {timeline_data.get('source_file', 'desconhecido')}")
    report.append(f"Gerado em: {timeline_data.get('generated_at', 'desconhecido')}")
    report.append(f"Duração total: {timeline_data.get('total_duration', 0):.2f}s")
    report.append(f"Total de segmentos: {len(timeline_data.get('segments', []))}")
    
    segments = timeline_data.get('segments', [])
    report.append("\nSegmentos:")
    
    for i, segment in enumerate(segments):
        start = segment.get('start', 0)
        end = segment.get('end', 0)
        speed = segment.get('speed', 1.0)
        seg_type = segment.get('type', 'normal')
        
        duration = end - start
        report.append(f"  {i}: {start:.2f}s - {end:.2f}s ({duration:.2f}s) | speed={speed} | type={seg_type}")
    
    silence_periods = timeline_data.get('silence_periods', [])
    report.append(f"\nPeríodos de silêncio detectados: {len(silence_periods)}")
    
    for i, silence in enumerate(silence_periods):
        report.append(f"  Silêncio {i}: {silence['start']:.2f}s - {silence['end']:.2f}s ({silence['duration']:.2f}s)")
    
    return "\n".join(report)

# Exemplo de uso
if __name__ == "__main__":
    # Exemplo de como usar o gerador de timeline
    timeline_gen = AudioTimelineGenerator()
    
    print("Gerador de Timeline de Áudio inicializado com sucesso!")
    print("Para usar:")
    print("1. timeline = timeline_gen.create_audio_timeline('caminho/para/audio.wav')")
    print("2. save_timeline_to_json(timeline, 'timeline_output.json')")
    print("3. Verifique o relatório: generate_sync_report(timeline)")
