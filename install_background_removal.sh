#!/bin/bash

# Script de instalação para remover fundo de vídeos com ícone na área de trabalho

echo "=== Instalador de Remoção de Fundo ==="

# Verifica se está no Linux
if [[ "$OSTYPE" != "linux-gnu"* ]]; then
    echo "Este script só funciona no Linux"
    exit 1
fi

# Cria diretório para o script se não existir
SCRIPT_DIR="$HOME/bin"
mkdir -p "$SCRIPT_DIR"

# Cria o script principal de remoção de fundo
cat > "$SCRIPT_DIR/remove_background.sh" << 'EOF'
#!/bin/bash

# Script para remover fundo de vídeos
# Autor: Sistema TikTok Live

echo "=== Remoção de Fundo de Vídeos ==="

# Verifica se o ffmpeg está instalado
if ! command -v ffmpeg &> /dev/null; then
    echo "ffmpeg não encontrado. Instalando..."
    sudo apt update && sudo apt install -y ffmpeg
fi

# Verifica se o OpenCV está instalado
if ! python3 -c "import cv2" &> /dev/null; then
    echo "OpenCV não encontrado. Instalando..."
    pip3 install opencv-python
fi

# Verifica se o mediapipe está instalado
if ! python3 -c "import mediapipe" &> /dev/null; then
    echo "MediaPipe não encontrado. Instalando..."
    pip3 install mediapipe
fi

# Função para remover fundo
remove_background() {
    local input_file="$1"
    local output_file="${2:-${input_file%.*}_no_bg.mp4}"
    
    if [ ! -f "$input_file" ]; then
        echo "Arquivo de entrada não encontrado: $input_file"
        return 1
    fi
    
    echo "Processando: $input_file"
    echo "Saída: $output_file"
    
    # Remove fundo usando MediaPipe (método simplificado)
    python3 -c "
import cv2
import mediapipe as mp
import numpy as np
import os

# Inicializa MediaPipe
mp_pose = mp.solutions.pose
mp_drawing = mp.solutions.drawing_utils
pose = mp_pose.Pose(static_image_mode=False, model_complexity=1, enable_segmentation=True)

# Abre o vídeo
cap = cv2.VideoCapture('$input_file')
if not cap.isOpened():
    print('Erro ao abrir o vídeo')
    exit(1)

# Obter propriedades do vídeo
fps = int(cap.get(cv2.CAP_PROP_FPS))
width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

# Configura codec de saída
fourcc = cv2.VideoWriter_fourcc(*'mp4v')
out = cv2.VideoWriter('$output_file', fourcc, fps, (width, height))

frame_count = 0
print('Processando frames...')

while True:
    ret, frame = cap.read()
    if not ret:
        break
        
    # Converte BGR para RGB
    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    
    # Processa com MediaPipe
    results = pose.process(rgb_frame)
    
    # Cria máscara de fundo
    if results.segmentation_mask is not None:
        # Cria máscara binária (personagem em frente)
        mask = np.zeros_like(results.segmentation_mask)
        mask[results.segmentation_mask > 0.5] = 255
        
        # Aplica máscara ao frame original
        frame_with_alpha = cv2.cvtColor(frame, cv2.COLOR_BGR2BGRA)
        frame_with_alpha[:, :, 3] = mask
        
        # Salva frame processado
        out.write(frame_with_alpha)
    else:
        # Se não conseguir segmentar, salva frame original
        out.write(frame)
    
    frame_count += 1
    if frame_count % 30 == 0:
        print(f'Frames processados: {frame_count}')

cap.release()
out.release()
pose.close()

print('Processamento concluído!')
print('Arquivo gerado: $output_file')
"

    echo "Remoção de fundo concluída!"
}

# Função principal
main() {
    if [ $# -eq 0 ]; then
        echo "Uso: $0 <arquivo_de_entrada> [arquivo_de_saida]"
        echo "Exemplo: $0 video.mp4"
        echo "Exemplo: $0 video.mp4 saida.mp4"
        exit 1
    fi
    
    INPUT_FILE="$1"
    OUTPUT_FILE="$2"
    
    remove_background "$INPUT_FILE" "$OUTPUT_FILE"
}

# Executa a função principal
main "$@"
EOF

# Torna o script executável
chmod +x "$SCRIPT_DIR/remove_background.sh"

# Cria o arquivo .desktop para o ícone na área de trabalho
cat > "$HOME/Desktop/RemoverFundo.desktop" << 'EOF'
[Desktop Entry]
Name=Remover Fundo
Comment=Remove fundo de vídeos
Exec=/home/$USER/bin/remove_background.sh
Icon=video-x-generic
Terminal=true
Type=Application
Categories=AudioVideo;Video;
EOF

# Cria link simbólico na área de trabalho se não existir
if [ ! -L "$HOME/Desktop/RemoverFundo.desktop" ]; then
    ln -sf "$HOME/Desktop/RemoverFundo.desktop" "$SCRIPT_DIR/RemoverFundo.desktop"
fi

echo "=== Instalação Concluída ==="
echo "Script instalado em: $SCRIPT_DIR/remove_background.sh"
echo "Ícone criado na área de trabalho"
echo ""
echo "Para usar:"
echo "1. Coloque o script em seu diretório de trabalho"
echo "2. Execute: chmod +x $SCRIPT_DIR/remove_background.sh"
echo "3. Use: $SCRIPT_DIR/remove_background.sh <arquivo.mp4>"
echo ""
echo "Exemplo: $SCRIPT_DIR/remove_background.sh video.mp4 saida.mp4"

echo ""
echo "=== Configurações Adicionais ==="
echo "Para melhor performance, instale dependências extras:"
echo "sudo apt install python3-opencv python3-mediapipe"