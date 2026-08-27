#!/usr/bin/env python3
"""
Integração do sistema de remoção de fundo com o painel de live
"""

import os
import subprocess
from pathlib import Path
from src.tiktok_live.settings import BACKGROUND_REMOVAL


class BackgroundRemovalIntegration:
    """
    Classe para integrar o sistema de remoção de fundo no painel de live
    """
    
    def __init__(self):
        self.script_path = os.path.expanduser(BACKGROUND_REMOVAL['script_path'])
        self.is_available = self._check_availability()
        
    def _check_availability(self) -> bool:
        """
        Verifica se o sistema de remoção de fundo está disponível
        """
        try:
            return os.path.exists(self.script_path)
        except Exception as e:
            print(f"Erro ao verificar disponibilidade: {str(e)}")
            return False
    
    def install_background_removal(self) -> bool:
        """
        Instala o sistema de remoção de fundo
        """
        try:
            # Verifica se já está instalado
            if self.is_available:
                print("Sistema de remoção de fundo já está instalado")
                return True
                
            # Executa o script de instalação
            install_script = os.path.join(os.path.dirname(__file__), 'install_background_removal.sh')
            if os.path.exists(install_script):
                print("Instalando sistema de remoção de fundo...")
                result = subprocess.run(['bash', install_script], 
                                       capture_output=True, text=True)
                
                if result.returncode == 0:
                    print("Sistema de remoção de fundo instalado com sucesso!")
                    self.is_available = True
                    return True
                else:
                    print(f"Erro na instalação: {result.stderr}")
                    return False
            else:
                print("Script de instalação não encontrado")
                return False
                
        except Exception as e:
            print(f"Erro ao instalar sistema de remoção de fundo: {str(e)}")
            return False
    
    def remove_background(self, input_file: str, output_file: str = None) -> bool:
        """
        Remove o fundo do vídeo
        """
        if not self.is_available:
            print("Sistema de remoção de fundo não disponível")
            return False
            
        try:
            if output_file is None:
                # Gera nome de arquivo de saída
                base_name = os.path.splitext(input_file)[0]
                output_file = f"{base_name}{BACKGROUND_REMOVAL['default_output_suffix']}"
                
            print(f"Removendo fundo do vídeo: {input_file}")
            print(f"Arquivo de saída: {output_file}")
            
            # Executa o script de remoção de fundo
            result = subprocess.run([self.script_path, input_file, output_file], 
                                  capture_output=True, text=True, check=True)
            
            print("Remoção de fundo concluída com sucesso!")
            return True
            
        except subprocess.CalledProcessError as e:
            print(f"Erro ao remover fundo: {e.stderr}")
            return False
        except Exception as e:
            print(f"Erro inesperado na remoção de fundo: {str(e)}")
            return False
    
    def get_available_formats(self) -> list:
        """
        Retorna os formatos de vídeo suportados
        """
        return BACKGROUND_REMOVAL['supported_formats']
    
    def get_quality_presets(self) -> dict:
        """
        Retorna os presets de qualidade disponíveis
        """
        return BACKGROUND_REMOVAL['quality_presets']

# Função para integrar com o painel de live
def integrate_with_live_panel(live_system):
    """
    Integra o sistema de remoção de fundo com o painel de live
    """
    try:
        # Cria instância do sistema de remoção de fundo
        bg_removal = BackgroundRemovalIntegration()
        
        # Verifica se está disponível
        if not bg_removal.is_available:
            print("Sistema de remoção de fundo não disponível. Instalando...")
            success = bg_removal.install_background_removal()
            if not success:
                print("Falha ao instalar sistema de remoção de fundo")
                return False
        
        # Adiciona métodos ao live_system
        live_system.remove_background = bg_removal.remove_background
        live_system.background_available = bg_removal.is_available
        
        print("Integração com sistema de remoção de fundo concluída!")
        return True
        
    except Exception as e:
        print(f"Erro na integração com painel: {str(e)}")
        return False

# Exemplo de uso
if __name__ == "__main__":
    # Exemplo de como usar a integração
    print("Exemplo de integração com sistema de remoção de fundo")
    
    # Criar uma instância do sistema
    bg_removal = BackgroundRemovalIntegration()
    
    if bg_removal.is_available:
        print("Sistema de remoção de fundo disponível")
        print(f"Formatos suportados: {bg_removal.get_available_formats()}")
        print(f"Presets de qualidade: {bg_removal.get_quality_presets()}")
    else:
        print("Sistema de remoção de fundo não disponível")
        print("Instalando...")
        success = bg_removal.install_background_removal()
        if success:
            print("Instalação concluída com sucesso!")
        else:
            print("Falha na instalação")