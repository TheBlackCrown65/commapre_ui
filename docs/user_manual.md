# Robot Verify - User Manual

Welcome to Robot Verify, the Enterprise Visual Regression Platform.

## 1. Getting Started
1. Access the platform at `https://robotverify.internal.bank`.
2. Login using your standard Bank/AD username and password. 
3. If this is your first time logging in, an account will be automatically provisioned for you.

## 2. Organization Structure
To organize your test suites, the platform uses a 3-tier hierarchy:
- **Department**: e.g., IT Department
- **Squad**: e.g., Mobile App Squad
- **Folder / Flow**: The actual test folders and test suites.

## 3. Creating a Test Flow
1. Navigate to **Settings** in the sidebar.
2. Select your Department and Squad.
3. Click **New Folder** to categorize your tests.
4. Inside the folder, click **New Flow**.
5. Upload your baseline (reference) screenshots for the flow.
6. (Optional) Define **Masks** by drawing over dynamic areas (e.g., timestamps) that should be ignored during comparison.

## 4. Running a Test
1. Navigate to **Run Test**.
2. Select the target Flow.
3. Upload the latest screenshots you want to verify.
4. Click **Compare**. 
5. The system will queue your job. Click to view the progress in the **Dashboard**.

## 5. Viewing Results
1. In the **Dashboard**, you will see your recent jobs.
2. Statuses include: `QUEUED`, `PROCESSING`, `COMPLETED`, `FAILED`.
3. Click on a completed job to see a detailed report.
4. If a test fails due to UI changes, you can use the **Heal** function to automatically update the baseline images to the new versions.

## 6. System Monitor (Admins Only)
Admins can view real-time server health (CPU, RAM, Disk) and Storage Breakdowns across all Squads via the **System Monitor** tab.
