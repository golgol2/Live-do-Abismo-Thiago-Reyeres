#!/usr/bin/env python3
"""
Sistema de preprocessamento automático de vídeos para live TikTok
Processa vídeos da pasta Falando e Mudo, removendo fundo com alpha adequado
"""

import os
import glob
import subprocess
import threading
from pathlib import Path
from typing import List, Dict
import time


class VideoPreprocessor:
    """
    Classe para preprocessamento automático de vídeos com remoção de fundo
    """
    
    def __init__(self):
        self.falando_dir = "assets/BONECO_MAPA_2D/Falando"
        self.mudo_dir = "assets/BONECO_MAPA_2D/Mudo"
        self.fundo_verde_falando = "assets/BONECO_MAPA_2D/Falando/FUNDO_VERDE"
        self.fundo_verde_mudo = "assets/BONECO_MAPA_2D/Mudo/FUNDO_VERDE"
        
        # Cria diretórios se não existirem
        os.makedirs(self.fundo_verde_falando, exist_ok=True)
        os.makedirs(self.fundo_verde_mudo, exist_ok=True)
        
    def get_processed_videos(self, source_dir: str, target_dir: str) -> set:
        """
        Obtém a lista de vídeos já processados
        """
        processed = set()
        
        # Verifica arquivos na pasta de destino
        if os.path.exists(target_dir):
            for file in os.listdir(target_dir):
                if file.endswith(('.mp4', '.webm')):
                    processed.add(file)
        
        return processed
    
    def get_unprocessed_videos(self, source_dir: str, target_dir: str) -> List[str]:
        """
        Obtém vídeos que ainda não foram processados
        """
        processed = self.get_processed_videos(source_dir, target_dir)
        unprocessed = []
        
        # Verifica arquivos na pasta de origem
        if os.path.exists(source_dir):
            for file in os.listdir(source_dir):
                if file.endswith(('.webm', '.mp4')) and file not in processed:
                    unprocessed.append(file)
        
        return unprocessed
    
    def process_video(self, source_file: str, target_file: str) -> bool:
        """
        Processa um único vídeo removendo o fundo
        """
        try:
            print(f"Processando vídeo: {source_file} -> {target_file}")
            
            # Verifica se o script de remoção de fundo existe
            script_path = os.path.expanduser("~/bin/remove_background.sh")
            if not os.path.exists(script_path):
                print(f"Script de remoção de fundo não encontrado: {script_path}")
                return False
            
            # Executa o script de remoção de fundo
            result = subprocess.run([script_path, source_file, target_file], 
                                  capture_output=True, text=True, check=True)
            
            print(f"Vídeo processado com sucesso: {target_file}")
            return True
            
        except subprocess.CalledProcessError as e:
            print(f"Erro ao processar vídeo {source_file}: {e.stderr}")
            return False
        except Exception as e:
            print(f"Erro inesperado ao processar {source_file}: {str(e)}")
            return False
    
    def process_folder(self, source_dir: str, target_dir: str) -> Dict[str, int]:
        """
        Processa todos os vídeos de uma pasta
        """
        stats = {
            'total': 0,
            'processed': 0,
            'failed': 0
        }
        
        unprocessed_videos = self.get_unprocessed_videos(source_dir, target_dir)
        
        print(f"Encontrados {len(unprocessed_videos)} vídeos não processados em {source_dir}")
        
        for video_file in unprocessed_videos:
            stats['total'] += 1
            
            # Define caminho de entrada e saída
            source_path = os.path.join(source_dir, video_file)
            target_name = os.path.splitext(video_file)[0] + '_no_bg.mp4'
            target_path = os.path.join(target_dir, target_name)
            
            # Processa o vídeo
            if self.process_video(source_path, target_path):
                stats['processed'] += 1
            else:
                stats['failed'] += 1
                
        return stats
    
    def process_all_folders(self) -> Dict[str, Dict[str, int]]:
        """
        Processa todas as pastas (Falando e Mudo)
        """
        print("Iniciando preprocessamento automático de vídeos...")
        
        results = {
            'falando': {},
            'mudo': {}
        }
        
        # Processa pasta Falando
        print("\nProcessando pasta Falando...")
        results['falando'] = self.process_folder(self.falando_dir, self.fundo_verde_falando)
        
        # Processa pasta Mudo
        print("\nProcessando pasta Mudo...")
        results['mudo'] = self.process_folder(self.mudo_dir, self.fundo_verde_mudo)
        
        print("\nPreprocessamento concluído!")
        print(f"Falando - Total: {results['falando']['total']}, Processados: {results['falando']['processed']}, Falhas: {results['falando']['failed']}")
        print(f"Mudo - Total: {results['mudo']['total']}, Processados: {results['mudo']['processed']}, Falhas: {results['mudo']['failed']}")
        
        return results
    
    def process_videos_async(self) -> threading.Thread:
        """
        Inicia o processamento em thread separada
        """
        def run_processing():
            self.process_all_folders()
        
        thread = threading.Thread(target=run_processing)
        thread.daemon = True
        thread.start()
        
        return thread


# Função para verificar se o sistema está configurado corretamente
def is_preprocessor_configured() -> bool:
    """
    Verifica se o preprocessador está configurado corretamente
    """
    try:
        preprocessor = VideoPreprocessor()
        
        # Verifica se os diretórios existem
        dirs_to_check = [
            preprocessor.falando_dir,
            preprocessor.mudo_dir,
            preprocessor.fundo_verde_falando,
            preprocessor.fundo_verde_mudo
        ]
        
        for directory in dirs_to_check:
            if not os.path.exists(directory):
                print(f"Diretório não encontrado: {directory}")
                return False
        
        # Verifica se o script de remoção de fundo está disponível
        script_path = os.path.expanduser("~/bin/remove_background.sh")
        if not os.path.exists(script_path):
            print(f"Script de remoção de fundo não encontrado: {script_path}")
            return False
            
        print("Sistema de preprocessamento configurado corretamente!")
        return True
        
    except Exception as e:
        print(f"Erro na verificação da configuração: {str(e)}")
        return False

# Exemplo de uso
if __name__ == "__main__":
    # Verifica configuração
    if is_preprocessor_configured():
        print("\nIniciando preprocessamento automático...")
        
        # Cria instância do preprocessador
        preprocessor = VideoPreprocessor()
        
        # Processa vídeos
        results = preprocessor.process_all_folders()
        
        print("\nResumo do processamento:")
        for folder, stats in results.items():
            print(f"{folder}: {stats['processed']}/{stats['total']} processados")
    else:
        print("Configuração do preprocessador não está correta!")