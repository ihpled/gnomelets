#!/usr/bin/env python3
import os
import shutil
from PIL import Image

def split_sprites(input_directory, output_directory):
    # Ensure input directory exists
    if not os.path.exists(input_directory):
        print(f"Input directory not found: {input_directory}")
        return

    # Ensure output directory exists
    if not os.path.exists(output_directory):
        os.makedirs(output_directory)

    # List all .png files in the input directory
    files = [f for f in os.listdir(input_directory) if f.endswith('.png')]
    
    generated_folders = []

    for filename in files:
        filepath = os.path.join(input_directory, filename)
        try:
            with Image.open(filepath) as img:
                width, height = img.size
                
                # We expect 6 frames horizontally
                frame_width = width // 6
                
                # Create a directory for the sprite in the input directory temporarily
                sprite_name = os.path.splitext(filename)[0]
                temp_sprite_dir = os.path.join(input_directory, sprite_name)
                
                if not os.path.exists(temp_sprite_dir):
                    os.makedirs(temp_sprite_dir)
                    print(f"Created temp directory: {temp_sprite_dir}")
                
                # Split and save frames
                for i in range(6):
                    # Define the crop box (left, top, right, bottom)
                    left = i * frame_width
                    
                    # Logica: for 0-4, standard width. For 5, take remaining width.
                    if i == 5:
                        right = width
                    else:
                        right = left + frame_width
                        
                    box = (left, 0, right, height)
                    
                    frame = img.crop(box)
                    frame_path = os.path.join(temp_sprite_dir, f"{i}.png")
                    frame.save(frame_path)
                
                print(f"Processed frames for {filename}")
                generated_folders.append(temp_sprite_dir)
                    
        except Exception as e:
            print(f"Error processing {filename}: {e}")

    # Move generated folders to output directory
    for temp_folder in generated_folders:
        folder_name = os.path.basename(temp_folder)
        target_path = os.path.join(output_directory, folder_name)
        
        # Remove target if it already exists to ensure clean move
        if os.path.exists(target_path):
            shutil.rmtree(target_path)
            
        shutil.move(temp_folder, output_directory)
        print(f"Moved directory {folder_name} to {output_directory}")

if __name__ == "__main__":
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    
    # Input: ./temp/images (relative to project root)
    input_dir = os.path.join(project_root, "temp", "images")
    
    # Output: ./src/images (relative to project root)
    output_dir = os.path.join(project_root, "src", "images")
    
    split_sprites(input_dir, output_dir)
