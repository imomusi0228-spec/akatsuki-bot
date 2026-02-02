
import sys

try:
    with open('error.log', 'r', encoding='utf-16') as f:
        print(f.read())
except Exception as e:
    print(f"Error reading file: {e}")
except UnicodeError:
     with open('error.log', 'r', encoding='utf-8') as f:
        print(f.read())
