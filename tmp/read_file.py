import chardet

file_path = r"c:\Users\dansy\Desktop\Bot\UPDATE_LOG.md"
with open(file_path, 'rb') as f:
    raw_data = f.read()
    result = chardet.detect(raw_data)
    encoding = result['encoding']
    print(f"Detected encoding: {encoding}")
    if encoding:
        print(raw_data.decode(encoding))
    else:
        print(raw_data.decode('utf-8', errors='replace'))
