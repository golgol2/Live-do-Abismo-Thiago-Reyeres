"""
Sistema completo de live para TikTok com abertura automática e gerenciamento de personagem
"""

import json
import time
import threading
from typing import Dict, List, Optional
import os
import subprocess

# Importar o preprocessador
from src.tiktok_live.video_preprocessor import VideoPreprocessor, is_preprocessor_configured

class LiveSystem:
    def __init__(self):
        self.is_live_running = False
        self.current_event = None
        self.personagem_active = False
        self.last_activity_time = 0
        self.activity_timeout = 300  # 5 minutos de inatividade
        self.tts_model_loaded = False
        self.opening_generated = False
        self.event_queue = []  # Fila para eventos pendentes
        self.event_lock = threading.Lock()  # Lock para thread safety
        self.background_removal_available = self._check_background_removal()
        self.video_preprocessor = VideoPreprocessor()
        self.tts_engine = None  # Motor TTS
        self.voice_model = None  # Modelo de voz
        
    def _check_background_removal(self) -> bool:
        """Verifica se o sistema de remoção de fundo está disponível"""
        try:
            # Verifica se o script de remoção de fundo existe
            script_path = os.path.expanduser("~/bin/remove_background.sh")
            return os.path.exists(script_path)
        except Exception as e:
            print(f"Erro ao verificar remoção de fundo: {str(e)}")
            return False
    
    def start_live(self):
        """Inicia a live com abertura automática"""
        print("Iniciando live com abertura automática...")
        
        # Gera abertura automática para aquecer o TTS
        self.generate_opening()
        
        # Inicializa o sistema
        self.is_live_running = True
        self.last_activity_time = time.time()
        
        # Inicia thread de monitoramento de inatividade
        monitoring_thread = threading.Thread(target=self._monitor_activity)
        monitoring_thread.daemon = True
        monitoring_thread.start()
        
        # Inicia thread para processar eventos pendentes
        event_thread = threading.Thread(target=self._process_event_queue)
        event_thread.daemon = True
        event_thread.start()
        
        print("Live iniciada com sucesso!")
        return True
    
    def generate_opening(self):
        """Gera abertura automática para aquecer o TTS"""
        if self.opening_generated:
            return
            
        print("Gerando abertura automática...")
        
        # Simula geração de conteúdo de abertura
        opening_content = {
            "type": "opening",
            "text": "Olá pessoal! Bem-vindos à minha live!",
            "timestamp": time.time(),
            "duration": 5.0
        }
        
        # Aqui você pode integrar com seu sistema de TTS
        self._process_tts_content(opening_content)
        
        print("Abertura gerada com sucesso!")
        self.opening_generated = True
    
    def _process_tts_content(self, content: Dict):
        """Processa conteúdo para TTS"""
        try:
            # Carrega o modelo TTS apenas uma vez
            if not self.tts_model_loaded:
                print("Carregando modelo TTS...")
                # Aqui você colocaria o código real de carregamento do modelo
                time.sleep(2)  # Simula tempo de carregamento
                self.tts_model_loaded = True
                print("Modelo TTS carregado com sucesso!")
            
            # Processa o conteúdo
            print(f"Processando conteúdo: {content.get('text', 'Sem texto')}")
            
            # Simula geração de áudio
            if content.get('type') == 'opening':
                print("Gerando abertura automática...")
            elif content.get('type') == 'response':
                print("Gerando resposta para mensagem...")
            elif content.get('type') == 'gift_response':
                print("Gerando resposta para presente...")
            elif content.get('type') == 'follow_response':
                print("Gerando resposta para novo seguidor...")
            
        except Exception as e:
            print(f"Erro no processamento TTS: {str(e)}")
    
    def handle_event(self, event_data: Dict):
        """Lida com eventos da live"""
        if not self.is_live_running:
            return False
            
        print(f"Evento recebido: {event_data.get('type', 'desconhecido')}")
        
        # Adiciona evento à fila para processamento
        with self.event_lock:
            self.event_queue.append(event_data)
        
        # Atualiza tempo de atividade
        self.last_activity_time = time.time()
        
        return True
    
    def _process_event_queue(self):
        """Processa eventos pendentes em uma thread separada"""
        while self.is_live_running:
            try:
                with self.event_lock:
                    if self.event_queue:
                        event_data = self.event_queue.pop(0)
                
                if 'event_data' in locals():
                    # Processa o evento
                    if event_data.get('type') == 'message':
                        self._process_message_event(event_data)
                    elif event_data.get('type') == 'gift':
                        self._process_gift_event(event_data)
                    elif event_data.get('type') == 'follow':
                        self._process_follow_event(event_data)
                    elif event_data.get('type') == 'like':
                        self._process_like_event(event_data)
                    elif event_data.get('type') == 'share':
                        self._process_share_event(event_data)
                
                time.sleep(0.1)  # Pequeno delay para evitar uso excessivo de CPU
                
            except Exception as e:
                print(f"Erro no processamento de eventos: {str(e)}")
                time.sleep(1)
    
    def _process_message_event(self, event_data: Dict):
        """Processa evento de mensagem"""
        message = event_data.get('message', '')
        print(f"Nova mensagem: {message}")
        
        # Gera resposta com TTS
        response_content = {
            "type": "response",
            "text": f"Obrigado por enviar: {message}",
            "timestamp": time.time()
        }
        
        self._process_tts_content(response_content)
        
        # Simula interação visual (pode ser integrado com sistema de personagem)
        print("Personagem respondendo à mensagem...")
    
    def _process_gift_event(self, event_data: Dict):
        """Processa evento de presente"""
        gift_name = event_data.get('gift_name', 'presente')
        print(f"Presente recebido: {gift_name}")
        
        # Gera resposta com TTS
        response_content = {
            "type": "gift_response",
            "text": f"Obrigado por enviar o presente {gift_name}!",
            "timestamp": time.time()
        }
        
        self._process_tts_content(response_content)
        
        # Simula interação visual
        print("Personagem agradecendo pelo presente...")
    
    def _process_follow_event(self, event_data: Dict):
        """Processa evento de follow"""
        print("Novo seguidor!")
        
        # Gera resposta com TTS
        response_content = {
            "type": "follow_response",
            "text": "Bem-vindo ao canal! Obrigado por seguir!",
            "timestamp": time.time()
        }
        
        self._process_tts_content(response_content)
        
        # Simula interação visual
        print("Personagem recebendo novo seguidor...")
    
    def _process_like_event(self, event_data: Dict):
        """Processa evento de like"""
        print("Curtida recebida!")
        
        # Gera resposta com TTS
        response_content = {
            "type": "like_response",
            "text": "Obrigado pelo like!",
            "timestamp": time.time()
        }
        
        self._process_tts_content(response_content)
        
        # Simula interação visual
        print("Personagem respondendo ao like...")
    
    def _process_share_event(self, event_data: Dict):
        """Processa evento de share"""
        print("Compartilhamento recebido!")
        
        # Gera resposta com TTS
        response_content = {
            "type": "share_response",
            "text": "Obrigado por compartilhar!",
            "timestamp": time.time()
        }
        
        self._process_tts_content(response_content)
        
        # Simula interação visual
        print("Personagem respondendo ao compartilhamento...")
    
    def _monitor_activity(self):
        """Monitora atividade para manter personagem ativo"""
        while self.is_live_running:
            try:
                current_time = time.time()
                time_since_last_activity = current_time - self.last_activity_time
                
                # Se estiver inativo por muito tempo, mantém personagem ativo
                if time_since_last_activity > self.activity_timeout:
                    print("Inatividade detectada, mantendo personagem ativo...")
                    self._keep_character_active()
                
                time.sleep(30)  # Verifica a cada 30 segundos
                
            except Exception as e:
                print(f"Erro no monitoramento de atividade: {str(e)}")
                time.sleep(30)
    
    def _keep_character_active(self):
        """Mantém o personagem ativo mesmo sem eventos"""
        if not self.personagem_active:
            print("Personagem em modo de manutenção...")
            
            # Gera conteúdo automático para manter personagem ativo
            maintenance_content = {
                "type": "maintenance",
                "text": "Estou aqui e sempre pronto para conversar!",
                "timestamp": time.time()
            }
            
            self._process_tts_content(maintenance_content)
            self.personagem_active = True
    
    def remove_background_from_video(self, input_file: str, output_file: str = None) -> bool:
        """Remove o fundo do vídeo usando o sistema instalado"""
        if not self.background_removal_available:
            print("Sistema de remoção de fundo não disponível")
            return False
            
        try:
            if output_file is None:
                # Gera nome de arquivo de saída
                base_name = os.path.splitext(input_file)[0]
                output_file = f"{base_name}_no_bg.mp4"
            
            print(f"Removendo fundo do vídeo: {input_file}")
            print(f"Arquivo de saída: {output_file}")
            
            # Executa o script de remoção de fundo
            script_path = os.path.expanduser("~/bin/remove_background.sh")
            result = subprocess.run([script_path, input_file, output_file], 
                                  capture_output=True, text=True, check=True)
            
            print("Remoção de fundo concluída com sucesso!")
            return True
            
        except subprocess.CalledProcessError as e:
            print(f"Erro ao remover fundo: {e.stderr}")
            return False
        except Exception as e:
            print(f"Erro inesperado na remoção de fundo: {str(e)}")
            return False
    
    def preprocess_videos(self) -> Dict[str, Dict[str, int]]:
        """Preprocessa vídeos das pastas Falando e Mudo"""
        print("Iniciando preprocessamento dos vídeos...")
        
        # Verifica se o preprocessador está configurado
        if not is_preprocessor_configured():
            print("Erro: Preprocessador não está configurado corretamente")
            return {}
            
        try:
            results = self.video_preprocessor.process_all_folders()
            print("Preprocessamento concluído!")
            return results
        except Exception as e:
            print(f"Erro no preprocessamento: {str(e)}")
            return {}
    
    def stop_live(self):
        """Encerra a live"""
        print("Encerrando live...")
        self.is_live_running = False
        print("Live encerrada com sucesso!")

# Classe para gerenciar o sistema de abertura automática
class AutoOpeningSystem:
    def __init__(self):
        self.live_system = LiveSystem()
        
    def initialize_with_opening(self):
        """Inicializa o sistema com abertura automática"""
        print("Inicializando sistema com abertura automática...")
        
        # Inicia a live
        self.live_system.start_live()
        
        # Gera abertura imediata
        self.live_system.generate_opening()
        
        print("Sistema inicializado com sucesso!")
        return True

# Função para verificar se o sistema está rodando
def is_system_running():
    """Verifica se o sistema de live está ativo"""
    try:
        # Aqui você pode adicionar lógica específica para verificar o estado
        return True
    except Exception as e:
        print(f"Erro ao verificar sistema: {str(e)}")
        return False

# Exemplo de uso
if __name__ == "__main__":
    # Inicializa o sistema com abertura automática
    auto_system = AutoOpeningSystem()
    auto_system.initialize_with_opening()
    
    # Simula eventos
    print("Simulando eventos...")
    time.sleep(2)
    
    auto_system.live_system.handle_event({
        "type": "message",
        "message": "Olá, tudo bem?"
    })
    
    time.sleep(2)
    
    auto_system.live_system.handle_event({
        "type": "gift",
        "gift_name": "coração"
    })
    
    # Mantém o sistema rodando por alguns segundos
    time.sleep(5)
    
    # Encerra a live
    auto_system.live_system.stop_live()