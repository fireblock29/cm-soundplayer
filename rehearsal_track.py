import os
import subprocess
from pathlib import Path

# --- CONFIGURATION ---
INPUT_DIR = "./musiques"  # Le dossier contenant tes chansons
OUTPUT_DIR = "./sorties"     # Là où les fichiers séparés iront
MODEL = "htdemucs"           # Le modèle par défaut (excellent compromis vitesse/qualité)

def bulk_separate():
    # Créer le dossier de sortie s'il n'existe pas
    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR)

    # Liste des extensions audio supportées
    extensions = ('.mp3', '.wav', '.flac', '.m4a', '.ogg')
    
    files = [f for f in os.listdir(INPUT_DIR) if f.lower().endswith(extensions)]
    
    if not files:
        print(f"Aucun fichier audio trouvé dans {INPUT_DIR}")
        return

    print(f"Extraction de {len(files)} fichiers en cours...")

    for file in files:
        input_path = os.path.join(INPUT_DIR, file)
        print(f"\n--- Traitement de : {file} ---")
        
        # Commande Demucs
        # --two-stems=vocals permet d'obtenir uniquement "vocals" et "no_vocals" (instrumental)
        # Si tu veux 4 pistes (drums, bass, other, vocals), retire "--two-stems=vocals"
        cmd = [
            "demucs",
            "--two-stems=vocals",
            "-o", OUTPUT_DIR,
            input_path
        ]
        
        subprocess.run(cmd)

    print("\nTerminé ! Tes pistes sont dans le dossier :", OUTPUT_DIR)

if __name__ == "__main__":
    bulk_separate()
