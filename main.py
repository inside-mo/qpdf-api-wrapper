from fastapi import FastAPI, UploadFile, HTTPException
import subprocess, tempfile, os
from fastapi.responses import FileResponse

app = FastAPI()

@app.post("/remove-metadata")
async def remove_metadata(file: UploadFile):
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as input_pdf:
            content = await file.read()
            input_pdf.write(content)
            input_path = input_pdf.name

        output_path = input_path.replace(".pdf", "_no_meta.pdf")
        subprocess.run(["qpdf", "--decrypt", input_path, output_path], check=True)
        return FileResponse(output_path, filename="processed.pdf")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if os.path.exists(input_path):
            os.remove(input_path)
        if os.path.exists(output_path):
            os.remove(output_path)
