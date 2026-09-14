pipeline {
    agent { label 'windows' }

    parameters {
        choice(name: 'FLOW_NAME', 
            choices: ['test_jenkins', 'test_jk', 'Login_Flow'], 
            description: 'เลือกชื่อ Flow เพื่อส่งรูปไปเปรียบเทียบที่ API')
    }

    environment {
        API_KEY = 'rv_XhL8PKYbqll-h48k9ugDmAIGW2u4OJqNryJNtMxWviI' 
        API_URL = 'http://127.0.0.1:8000/api/v1' 
        AVD_NAME = 'Pixel_4'
        APK_PATH = 'C:\\Users\\user\\Desktop\\สอน\\install\\mda-2.2.0-25.apk'
        APP_PACKAGE = 'com.saucelabs.mydemoapp.android'
        WORK_DIR = 'C:\\Users\\user\\Desktop\\สอน'
        ANDROID_HOME = 'C:\\Users\\user\\AppData\\Local\\Android\\Sdk'
    }

    stages {
        stage('Prepare Environment') {
            steps {
                echo '🚀 Starting Services & Emulator...'
                bat '''
                    :: 💡 ปิด Emulator เก่าที่อาจจะค้างอยู่ด้วยคำสั่งของ adb โดยตรง
                    "%ANDROID_HOME%\\platform-tools\\adb.exe" emu kill >nul 2>&1 || exit 0
                    taskkill /F /IM qemu-system-x86_64.exe /T >nul 2>&1 || exit 0
                    taskkill /F /IM node.exe /T >nul 2>&1 || exit 0
                    "%ANDROID_HOME%\\platform-tools\\adb.exe" kill-server >nul 2>&1 || exit 0
                '''
                powershell '''
                    # รัน Appium พร้อม base-path
                    Start-Process -FilePath "cmd.exe" -ArgumentList "/c npx appium --address 127.0.0.1 --port 4723 --base-path /wd/hub > appium_log.txt 2>&1" -WindowStyle Hidden
                    
                    # 💡 รัน Emulator แบบ Headless (ไม่มีหน้าจอ) และไม่เซฟ Snapshot ทับเพื่อป้องกันไฟล์พัง
                    $EmuPath = "$env:ANDROID_HOME\\emulator\\emulator.exe"
                    $EmuArgs = "-avd $env:AVD_NAME -no-audio -no-snapshot-save"
                    Start-Process -FilePath "cmd.exe" -ArgumentList "/c `"$EmuPath`" $EmuArgs" -WindowStyle Hidden
                '''
                
                echo '⏳ Waiting for Emulator to fully boot...'
                bat '''
                    :: 💡 เปลี่ยนจากการรอ 30 วิเฉยๆ มาเป็นการเช็คสถานะ boot_completed ของ Android ให้ชัวร์ 100%
                    "%ANDROID_HOME%\\platform-tools\\adb.exe" wait-for-device
                    :WAIT_BOOT
                    "%ANDROID_HOME%\\platform-tools\\adb.exe" shell getprop sys.boot_completed | find "1" >nul 2>&1
                    if errorlevel 1 (
                        ping 127.0.0.1 -n 3 >nul
                        goto WAIT_BOOT
                    )
                '''

                echo '📦 Installing APK...'
                bat '''
                    "%ANDROID_HOME%\\platform-tools\\adb.exe" install -r -g "%APK_PATH%"
                '''
            }
        }

        stage('Run Robot Framework') {
            steps {
                dir(env.WORK_DIR) {
                    echo '🤖 Running Robot Test...'
                    bat '''
                        if exist robot_logs rmdir /s /q robot_logs
                    '''
                    catchError(buildResult: 'UNSTABLE', stageResult: 'FAILURE') {
                        bat 'robot -d robot_logs test.robot'
                    }
                }
            }
        }

        stage('Prepare Data And Compare Screen') {
            steps {
                dir(env.WORK_DIR) {
                    echo '🗜️ Zipping screenshots & Uploading to API...'
                    powershell '''
                        if (Test-Path "screenshots.zip") { Remove-Item "screenshots.zip" -Force }
                        if (Test-Path "robot_logs\\*.png") {
                            Compress-Archive -Path robot_logs\\*.png -DestinationPath screenshots.zip
                        }
                    '''
                    bat '''
                        curl.exe -s -X POST "%API_URL%/jobs/compare" ^
                          -H "Authorization: Bearer %API_KEY%" ^
                          -F "flow_name=%FLOW_NAME%" ^
                          -F "file=@screenshots.zip" > response.json
                    '''
                    powershell '''
                        $content = Get-Content response.json -Raw
                        Write-Host "=== API RESPONSE ==="
                        Write-Host $content
                        Write-Host "===================="
                        
                        try {
                            $resp = $content | ConvertFrom-Json
                            if ($resp.job_id) {
                                $resp.job_id | Out-File -FilePath current_job_id.txt -Encoding ascii -NoNewline
                                Write-Host "✅ Job ID: $($resp.job_id)"
                            } elseif ($resp.detail) {
                                Write-Host "❌ API Error: $($resp.detail)"
                                exit 1
                            } else {
                                Write-Host "❌ Failed: job_id not found in response"
                                exit 1 
                            }
                        } catch {
                            Write-Host "❌ Failed: Could not parse JSON response"
                            exit 1
                        }
                    '''
                }
            }
        }

        stage('Send Result To Jenkins') {
            steps {
                dir(env.WORK_DIR) {
                    echo '⏳ Processing Results & Downloading PDF...'
                    powershell '''
                        if (-not (Test-Path current_job_id.txt)) { exit 1 }
                        $job_id = Get-Content current_job_id.txt
                        $url = "$env:API_URL/jobs/$job_id"
                        $headers = @{ "Authorization" = "Bearer $env:API_KEY" }
                        
                        $status = "QUEUED"
                        while ($status -match "QUEUED|PROCESSING") {
                            Start-Sleep -Seconds 5
                            $status = (Invoke-RestMethod -Uri "$url/status" -Headers $headers -Method Get).status
                            Write-Host "Current Status: $status"
                        }
                        
                        if ($status -eq "COMPLETED") {
                            Write-Host "✅ Downloading Reports..."
                            
                            Invoke-RestMethod -Uri "$url/download" -Headers $headers -Method Get -OutFile "Report_Images.zip"
                            
                            if (Test-Path "*.pdf") { Remove-Item "*.pdf" -Force -ErrorAction SilentlyContinue }
                            
                            $pdfName = "$($env:FLOW_NAME)_$($job_id).pdf"
                            
                            try {
                                Write-Host "Downloading PDF report from API..."
                                
                                Invoke-RestMethod -Uri "$url/export/pdf" -Headers $headers -Method Get -OutFile $pdfName
                                
                                if (Test-Path $pdfName) {
                                    Write-Host "✅ PDF Downloaded successfully: $pdfName"
                                } else {
                                    Write-Host "⚠️ PDF download failed - file not created."
                                }
                            } catch {
                                Write-Host "❌ Could not download PDF report: $_"
                            }
                        } else { exit 1 }
                    '''
                    archiveArtifacts artifacts: '*.pdf', allowEmptyArchive: true
                }
            }
        }
    }
    post {
        always {
            dir(env.WORK_DIR) {
                echo '📊 Publishing Robot Framework Results...'
                
                step([$class: 'RobotPublisher',
                    outputPath: 'robot_logs',
                    outputFileName: 'output.xml',
                    reportFileName: 'report.html',
                    logFileName: 'log.html',
                    disableArchiveOutput: false,
                    passThreshold: 100.0,
                    unstableThreshold: 0.0,
                    otherFiles: ''])

                echo '🧹 Clean Up Workspace & Suspend Emulator...'
                bat '''
                    "%ANDROID_HOME%\\platform-tools\\adb.exe" uninstall "%APP_PACKAGE%" 2>nul 
                    
                    :: 💡 ปิด Emulator แบบนุ่มนวล เพื่อไม่ให้ Snapshot เสียหาย
                    "%ANDROID_HOME%\\platform-tools\\adb.exe" emu kill 2>nul
                    
                    del screenshots.zip response.json current_job_id.txt log.html output.xml report.html Report_Images.zip api_report_temp.html *.pdf 2>nul
                    if exist robot_logs rmdir /s /q robot_logs
                '''
                powershell 'Stop-Process -Name "node" -Force -ErrorAction SilentlyContinue 2>$null'
            }
        }
    }
}